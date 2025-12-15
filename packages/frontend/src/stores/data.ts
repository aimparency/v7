import { defineStore } from 'pinia'
import type { Phase as BasePhase, Aim as BaseAim } from 'shared'
import { trpc } from '../trpc'
import { useUIStore } from './ui'
import { calculateAimValues } from '../utils/value-calculation'

// Extend Phase type with UI-only properties
export type Phase = BasePhase & {
  selectedAimIndex?: number
  lastSelectedSubPhaseIndex?: number
}

// Extend Aim type with UI-only properties
export type Aim = BaseAim & {
  expanded?: boolean
  selectedIncomingIndex?: number
}

export const useDataStore = defineStore('data', {
  state: () => ({
    phases: {} as Record<string, Phase>,
    aims: {} as Record<string, Aim>,
    childrenByParentId: {} as Record<string, string[]>,
    loading: false,
    error: null as string | null,
    migrated: false, // Track if we've run the migration
    subscription: null as { unsubscribe: () => void } | null,
    
    // Floating aims
    floatingAimsIds: [] as string[],
    
    // Calculated values
    calculatedValues: new Map<string, number>(),
    totalIntrinsicValue: 0,

    // Persistence Debounce
    saveTimeout: null as any,
    pendingUpdates: new Set<string>(),
  }),

  getters: {
    getPhasesByParentId: (state) => (parentId: string | null): Phase[] => {
      const key = parentId ?? 'null'
      const childIds = state.childrenByParentId[key] || []
      return childIds.map(id => state.phases[id]).filter((p): p is Phase => !!p).sort((a, b) => {
        // Sort by midpoint (average of start and end)
        if (!a || !b) return 0
        const aMid = (a.from + a.to) / 2
        const bMid = (b.from + b.to) / 2
        return aMid - bMid
      })
    },
    floatingAims(state): Aim[] {
      return state.floatingAimsIds.map(id => state.aims[id]).filter((a): a is Aim => !!a);
    }, 
    getFloatingAimByIndex() { 
      return (index: number) => this.floatingAims[index]
    }, 
    getAimsForPhase: (state) => (phaseId: string): Aim[] => {
      const phase = state.phases[phaseId]
      if (!phase) return []
      return phase.commitments.map(aimId => state.aims[aimId]).filter((a): a is Aim => !!a)
    },

    getAimValue: (state) => (aimId: string): number => {
      const normalized = state.calculatedValues.get(aimId) || 0
      return normalized * state.totalIntrinsicValue
    },

    graphData(state) {
      const aims = Object.values(state.aims)
      const depthMap = new Map<string, number>()
      
      // Calculate depths (BFS)
      const queue: { id: string, depth: number }[] = []
      
      // Find roots (no parents)
      aims.forEach(aim => {
        if (!aim.supportedAims || aim.supportedAims.length === 0) {
          depthMap.set(aim.id, 0)
          queue.push({ id: aim.id, depth: 0 })
        }
      })
      
      // Traverse down
      let visited = new Set<string>() // Prevent cycles
      while(queue.length > 0) {
        const { id, depth } = queue.shift()!
        if(visited.has(id)) continue
        visited.add(id)
        
        const aim = state.aims[id]
        if (aim) {
          const incoming = aim.incoming || []
          incoming.forEach(childId => {
            // Assign max depth if multi-parent? For tree view, depth+1 is fine.
            // If already visited, we might update depth if we want longest path?
            // For now simple BFS is okay.
            if (!depthMap.has(childId)) {
              depthMap.set(childId, depth + 1)
              queue.push({ id: childId, depth: depth + 1 })
            }
          })
        }
      }

      const nodes = aims.map(aim => ({
        id: aim.id,
        text: aim.text,
        status: aim.status.state,
        depth: depthMap.get(aim.id) ?? 0,
        // Properties for force layout (mutable)
        x: 0, 
        y: 0, 
        vx: 0, 
        vy: 0,
        fx: null as number | null, // Fixed position
        fy: null as number | null,
        value: state.calculatedValues.get(aim.id) || 0 // Add value here for graph
      }))

      const links: { source: string, target: string, type: 'hierarchy', relativePosition: [number, number], weight: number }[] = []

      aims.forEach(aim => {
        // Draw links from Parent (aim) to Child (supportingConnections)
        if (aim.supportingConnections) {
            aim.supportingConnections.forEach(conn => {
            const childId = conn.aimId
            // Verify child exists to avoid broken links
            if (state.aims[childId]) {
                links.push({ 
                  source: aim.id, 
                  target: childId, 
                  type: 'hierarchy',
                  relativePosition: conn.relativePosition,
                  weight: conn.weight
                })
            }
            })
        }
      })

      return { nodes, links }
    }
  },

  actions: {
    recalculateValues() {
        const allAims = Object.values(this.aims) as Aim[];
        const result = calculateAimValues(allAims);
        this.calculatedValues = result.values;
        this.totalIntrinsicValue = result.totalIntrinsic;
    },

    async loadFloatingAims(projectPath: string) {
      if (!projectPath) return;
      
      // Only load if not loaded? Or always reload to be fresh?
      // Let's reload to be safe, but we can check if we have them.
      // For now, simple reload of all floating aims.
      
      this.loading = true;
      try {
        const aims = await trpc.aim.list.query({
          projectPath,
          floating: true
        });

        this.floatingAimsIds = [];
        for (const aim of aims) {
          this.replaceAim(aim.id, aim);
          this.floatingAimsIds.push(aim.id);
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to load floating aims:', error);
      } finally {
        this.loading = false;
      }
    },

    async runMigration(projectPath: string) {
      if (!projectPath || this.migrated) return

      try {
        await Promise.all([
            trpc.project.migrateCommittedIn.mutate({ projectPath }),
            trpc.project.migrateIncoming.mutate({ projectPath })
        ])
        this.migrated = true
      } catch (error) {
        console.warn('Migration failed, continuing anyway:', error)
        this.migrated = true // Don't retry on every load
      }
    },
    
    async createAndSelectPhase(projectPath: string, phaseData: Omit<Phase, 'id'>, columnIndex: number) {
      if (!projectPath) return;
      
      const { id: newPhaseId } = await trpc.phase.create.mutate({ projectPath, phase: phaseData });

      await this.loadPhases(projectPath, phaseData.parent);

      const uiStore = useUIStore();
      const newPhases = this.getPhasesByParentId(phaseData.parent);
      const newPhaseIndex = newPhases.findIndex(p => p && p.id === newPhaseId);

      if (newPhaseIndex !== -1) {
          uiStore.selectPhase(columnIndex, newPhaseIndex);
      }

      if (columnIndex >= uiStore.rightmostColumnIndex) {
          uiStore.setMinRightmost(columnIndex + 1);
      }
    },


    // Removed multi-column helper methods - now handled by teleport system

    // Helper to replace phase while preserving UI-only properties
    replacePhase(phaseId: string, newPhase: BasePhase) {
      const oldPhase = this.phases[phaseId]
      const oldSelectedAimIndex = oldPhase?.selectedAimIndex
      const oldSelectedSubPhaseIndex = oldPhase?.lastSelectedSubPhaseIndex

      // Replace with new data
      this.phases[phaseId] = newPhase as Phase

      // Restore validated UI state
      if (oldSelectedAimIndex !== undefined && newPhase.commitments.length > 0) {
        const maxIndex = newPhase.commitments.length - 1
        if (oldSelectedAimIndex <= maxIndex) {
          this.phases[phaseId].selectedAimIndex = oldSelectedAimIndex
        } else {
          // Index out of bounds - clamp to last valid index
          console.warn(`Phase ${phaseId} selectedAimIndex ${oldSelectedAimIndex} out of bounds (max ${maxIndex}), clamping to ${maxIndex}`)
          this.phases[phaseId].selectedAimIndex = maxIndex
        }
      }

      if (oldSelectedSubPhaseIndex !== undefined) {
        this.phases[phaseId].lastSelectedSubPhaseIndex = oldSelectedSubPhaseIndex
      }
    },

    // Helper to replace aim while preserving UI-only properties
    replaceAim(aimId: string, newAim: BaseAim) {
      const oldAim = this.aims[aimId]
      const oldExpanded = oldAim?.expanded ?? false
      const oldSelectedIndex = oldAim?.selectedIncomingIndex

      // NORMALIZE: Ensure supportingConnections exists if incoming is present (server backward compatibility)
      if (!newAim.supportingConnections && newAim.incoming) {
        newAim.supportingConnections = newAim.incoming.map(id => ({ 
            aimId: id, 
            weight: 1, 
            relativePosition: [0, 0] as [number, number] 
        }))
      }

      // Replace with new data
      this.aims[aimId] = Object.assign({
        expanded: false,
        selectedIncomingIndex: undefined
      }, newAim) as Aim

      // Restore validated UI state
      this.aims[aimId].expanded = oldExpanded

      if (oldSelectedIndex !== undefined && newAim.supportingConnections && newAim.supportingConnections.length > 0) {
        const maxIndex = newAim.supportingConnections.length - 1
        if (oldSelectedIndex <= maxIndex) {
          this.aims[aimId].selectedIncomingIndex = oldSelectedIndex
        } else {
          // Index out of bounds - clamp to last valid index
          console.warn(`Selection index ${oldSelectedIndex} out of bounds (max ${maxIndex}) for aim ${aimId}, clamping to ${maxIndex}`)
          this.aims[aimId].selectedIncomingIndex = maxIndex
        }
      }
    },

    async createFloatingAim(projectPath: string, aim: Omit<Aim, 'id' | 'incoming' | 'supportedAims' | 'committedIn'>): Promise<{id: string}> {
      try {
        const newAim = await trpc.aim.createFloatingAim.mutate({
          projectPath,
          aim
        })

        this.aims[newAim.id] = newAim
        
        // Add to floating list if it matches criteria (it should)
        // Add to START of list (if sorted by date desc?) or END? 
        // list-aims default sort is probably filesystem order or date? 
        // Let's prepend for now as "newest".
        if (!this.floatingAimsIds.includes(newAim.id)) {
          this.floatingAimsIds.unshift(newAim.id);
        }
        
        this.recalculateValues();

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create aim:', error)
        throw error
      }
    },

    async createSubAim(projectPath: string, parentAimId: string, aim: Omit<Aim, 'id' | 'incoming' | 'supportedAims' | 'committedIn'>, positionInParent?: number): Promise<{id: string}> {
      try {
        const newAim = await trpc.aim.createSubAim.mutate({
          projectPath,
          parentAimId,
          aim,
          positionInParent
        })

        // Reload parent aim to get updated connections
        const parentAim = await trpc.aim.get.query({ projectPath, aimId: parentAimId })
        if (parentAim) {
          this.replaceAim(parentAimId, parentAim)
        }

        // Reload child aim to get updated supportedAims array
        // This ensures it doesn't appear in floating aims
        const updatedChildAim = await trpc.aim.get.query({ projectPath, aimId: newAim.id })
        if (updatedChildAim) {
          this.replaceAim(newAim.id, updatedChildAim)
        }
        
        this.recalculateValues();

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create sub-aim:', error)
        throw error
      }
    }, 

    async createCommittedAim(projectPath: string, phaseId: string, aim: Omit<Aim, 'id' | 'incoming' | 'supportedAims' | 'committedIn'>, insertionIndex?: number): Promise<{id: string}> {
      try {
        const newAim = await trpc.aim.createAimInPhase.mutate({
          projectPath,
          phaseId,
          aim,
          insertionIndex
        })

        this.aims[newAim.id] = newAim

        // Reload the specific phase to get updated commitments
        const phase = await trpc.phase.get.query({ projectPath, phaseId })
        if (phase) {
          this.replacePhase(phaseId, phase)
        }
        
        this.recalculateValues();

        return newAim
      } catch (error) {
        console.error('Failed to create aim in phase:', error)
        throw error
      }
    },

    async updateAim(projectPath: string, aimId: string, updates: Partial<Omit<Aim, 'id'>>): Promise<void> {
      try {
        const updatedAim = await trpc.aim.update.mutate({
          projectPath,
          aimId,
          aim: updates
        })

        // Update local state
        this.replaceAim(aimId, updatedAim)
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to update aim:', error)
        throw error
      }
    },

    async updateConnectionPosition(projectPath: string, parentId: string, childAimId: string, newRelativePosition: [number, number]) {
      const parent = this.aims[parentId]
      if (!parent) return

      const connections = parent.supportingConnections || []
      const connectionIndex = connections.findIndex(c => c.aimId === childAimId)
      
      if (connectionIndex !== -1) {
        // 1. Update local state immediately
        const updatedConnections = [...connections]
        const oldConn = updatedConnections[connectionIndex]!
        updatedConnections[connectionIndex] = {
          aimId: oldConn.aimId,
          weight: oldConn.weight,
          relativePosition: newRelativePosition
        }
        parent.supportingConnections = updatedConnections

        // 2. Queue for persistence
        this.pendingUpdates.add(parentId)
        
        // 3. Debounce save
        if (this.saveTimeout) clearTimeout(this.saveTimeout)
        
        this.saveTimeout = setTimeout(() => {
          this.flushUpdates(projectPath)
        }, 5000)
      }
    },

    async flushUpdates(projectPath: string) {
      const updates = Array.from(this.pendingUpdates)
      this.pendingUpdates.clear()
      this.saveTimeout = null

      try {
        await Promise.all(updates.map(aimId => {
          const aim = this.aims[aimId]
          if (!aim) return Promise.resolve()
          return this.updateAim(projectPath, aimId, {
            supportingConnections: aim.supportingConnections
          })
        }))
      } catch (e) {
        console.error("Failed to flush updates", e)
      }
    },
    
    async commitAimToPhase(projectPath: string, aimId: string, phaseId: string, insertionIndex?: number) {
      try {
        // Use the new backend endpoint that maintains bidirectional relationship
        await trpc.aim.commitToPhase.mutate({
          projectPath,
          aimId,
          phaseId,
          insertionIndex
        })

        // Update local state - reload the specific phase to get updated commitments
        const phase = await trpc.phase.get.query({ projectPath, phaseId })
        if (phase) {
          this.replacePhase(phaseId, phase)
        }

        // Reload the aim to get updated committedIn field
        const aim = await trpc.aim.get.query({ projectPath, aimId })
        if (aim) {
          this.replaceAim(aimId, aim)
        }
        
        // Remove from floating aims if present
        const index = this.floatingAimsIds.indexOf(aimId)
        if (index !== -1) {
            this.floatingAimsIds.splice(index, 1)
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to commit aim to phase:', error)
        throw error
      }
    },
    
    async deleteAimFromStore(projectPath: string, aimId: string) {
      try {
        await trpc.aim.delete.mutate({
          projectPath,
          aimId
        })
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to delete aim:', error)
        throw error
      }
    },
    
    async removeAimFromPhase(projectPath: string, aimId: string, phaseId: string) {
      try {
        await trpc.aim.removeFromPhase.mutate({
          projectPath,
          aimId,
          phaseId
        })

        // Update local state - reload data to ensure consistency
        await this.loadAllAims(projectPath);
        await this.loadPhases(projectPath, null);

        // Check if it needs to be added to floating
        const aim = await trpc.aim.get.query({ projectPath, aimId })
        if (aim) {
            this.replaceAim(aimId, aim)
            const isFloating = (!aim.committedIn || aim.committedIn.length === 0) && (!aim.supportedAims || aim.supportedAims.length === 0);
            if (isFloating && !this.floatingAimsIds.includes(aimId)) {
                this.floatingAimsIds.unshift(aimId)
            }
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to remove aim from phase:', error)
        throw error
      }
    },

    async loadPhases(projectPath: string, parentId: string | null): Promise<Phase[]> {
      if (!projectPath) return [];
      this.loading = true;
      try {
        const phases = await trpc.phase.list.query({ projectPath, parentPhaseId: parentId });
        const childIds: string[] = [];
        for (const phase of phases) {
          this.replacePhase(phase.id, phase);
          childIds.push(phase.id);
        }
        this.childrenByParentId[parentId ?? 'null'] = childIds;
        return phases;
      } catch (error) {
        this.error = 'Failed to load phases';
        console.error(this.error, error);
        return [];
      } finally {
        this.loading = false;
      }
    },

    async loadAllAims(projectPath: string) {
      if (!projectPath) return;
      this.loading = true;
      try {
        const aims = await trpc.aim.list.query({ projectPath });
        for (const aim of aims) {
          this.replaceAim(aim.id, aim);
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to load all aims:', error);
      } finally {
        this.loading = false;
      }
    },

    async loadProject(projectPath: string) {
      const uiStore = useUIStore();

      if (!projectPath) return;

      try {
        uiStore.setProjectPath(projectPath);
        uiStore.setConnectionStatus('connecting');

        // Repair project state (clean up invalid commitments)
        await trpc.project.repair.mutate({ projectPath });

        // Start subscription
        this.subscribeToUpdates(projectPath);

        // Load initial data
        await this.loadFloatingAims(projectPath);
        await this.loadPhases(projectPath, null); // Load root phases

        // We also need to load aims for visible phases? 
        // Phase.vue calls loadPhaseAims implicitly? No, Phase.vue just computes from store.
        // We need to ensure aims for visible phases are loaded.
        // Since we don't load all aims anymore, we rely on:
        // 1. Root phases are loaded.
        // 2. When a phase is rendered, it needs its aims.
        // Ideally, Phase component should trigger load.
        
        // For now, let's trigger load for root phases' aims to avoid empty view on start
        // But root phases list is async.
        
        uiStore.setConnectionStatus('connected');
        uiStore.addProjectToHistory(projectPath);
        uiStore.clearProjectFailure(projectPath);
      } catch (error) {
        console.error('Failed to load project:', error);
        uiStore.setConnectionStatus('no connection');
        uiStore.markProjectAsFailed(projectPath);
      }
    },

    subscribeToUpdates(projectPath: string) {
      if (this.subscription) {
        this.subscription.unsubscribe();
      }

      // @ts-ignore - trpc subscription typing might differ
      this.subscription = trpc.project.onUpdate.subscribe(undefined, {
        onData: async (data: { type: string, id: string, projectPath: string }) => {
          if (data.projectPath !== projectPath) return;

          console.log('Received update:', data);
          if (data.type === 'aim') {
             try {
               const aim = await trpc.aim.get.query({ projectPath, aimId: data.id });
               this.replaceAim(aim.id, aim);

               // Logic to update floating aims list
               // A floating aim has no commitments AND no outgoing connections (is not a parent)
               // Note: 'outgoing' contains IDs of aims that depend on this aim (children? no, depends on definition)
               // In aimparency: outgoing = children (sub-aims). Wait, let's verify.
               // connectAimsInternal: parent.incoming.push(child), child.outgoing.push(parent).
               // So outgoing = PARENTS. incoming = CHILDREN.
               // So a root aim has NO PARENTS (no outgoing). Correct.
               const isFloating = (!aim.committedIn || aim.committedIn.length === 0) && (!aim.supportedAims || aim.supportedAims.length === 0);
               
               if (isFloating) {
                 if (!this.floatingAimsIds.includes(aim.id)) {
                   this.floatingAimsIds.unshift(aim.id);
                 }
               } else {
                 const index = this.floatingAimsIds.indexOf(aim.id);
                 if (index !== -1) {
                   this.floatingAimsIds.splice(index, 1);
                 }
               }
               this.recalculateValues();
             } catch (e) {
               if (this.aims[data.id]) delete this.aims[data.id];
               
               // Also remove from floating list if deleted/error
               const index = this.floatingAimsIds.indexOf(data.id);
               if (index !== -1) {
                 this.floatingAimsIds.splice(index, 1);
               }
               this.recalculateValues();
             }
          } else if (data.type === 'phase') {
             try {
               const phase = await trpc.phase.get.query({ projectPath, phaseId: data.id });
               this.replacePhase(phase.id, phase);

               // Update childrenByParentId to ensure list consistency
               const parentId = phase.parent ?? 'null';
               if (!this.childrenByParentId[parentId]) {
                 this.childrenByParentId[parentId] = [];
               }
               if (!this.childrenByParentId[parentId].includes(phase.id)) {
                 this.childrenByParentId[parentId].push(phase.id);
                 
                 // Re-sort the list by time
                 this.childrenByParentId[parentId].sort((aId, bId) => {
                    const a = this.phases[aId];
                    const b = this.phases[bId];
                    if (!a || !b) return 0;
                    const aMid = (a.from + a.to) / 2;
                    const bMid = (b.from + b.to) / 2;
                    return aMid - bMid;
                 });
               }
             } catch (e) {
               if (this.phases[data.id]) delete this.phases[data.id];
             }
          }
        },
        onError: (err: any) => console.error('Subscription error:', err)
      });
    },

    async deletePhase(phaseId: string, parentPhaseId: string | null) {
      const uiStore = useUIStore();

      try {
        // Get child phases and update their parent
        const childPhases = await trpc.phase.list.query({
          projectPath: uiStore.projectPath,
          parentPhaseId: phaseId
        });

        for (const child of childPhases) {
          await trpc.phase.update.mutate({
            projectPath: uiStore.projectPath,
            phaseId: child.id,
            phase: { parent: parentPhaseId }
          });
        }

        // Delete the phase
        await trpc.phase.delete.mutate({
          projectPath: uiStore.projectPath,
          phaseId: phaseId
        });
      } catch (error) {
        console.error('Failed to delete phase:', error);
      }
    },

    // Recursive helper to delete a sub-aim and all its children
    async deleteSubAimRecursive(projectPath: string, aimId: string, parentAimId: string) {
      const aim = this.aims[aimId]
      if (!aim) return

      // 1. Recursively delete all incoming aims (children) first
      if (aim.incoming && aim.incoming.length > 0) {
        for (const childAimId of [...aim.incoming]) {
          await this.deleteSubAimRecursive(projectPath, childAimId, aimId)
        }
      }

      // 2. Remove this aim from the parent's incoming array
      const parentAim = this.aims[parentAimId]
      if (parentAim && parentAim.incoming) {
        const wasExpanded = parentAim.expanded
        const updatedIncoming = parentAim.incoming.filter(id => id !== aimId)
        await this.updateAim(projectPath, parentAimId, {
          incoming: updatedIncoming
        })
        // Restore expanded state (it's UI-only, not persisted)
        if (wasExpanded && this.aims[parentAimId]) {
          this.aims[parentAimId].expanded = true
        }
      }

      // 3. Remove the parent from this aim's supportedAims array
      const updatedSupportedAims = aim.supportedAims.filter(id => id !== parentAimId)

      // 4. If this aim has no other parents (supportedAims connections), delete it completely
      if (updatedSupportedAims.length === 0) {
        await trpc.aim.delete.mutate({
          projectPath,
          aimId: aimId
        })
        delete this.aims[aimId]
      } else {
        // Still has other parents, just update the supportedAims array
        await this.updateAim(projectPath, aimId, {
          supportedAims: updatedSupportedAims
        })
      }
    },

    async deleteAim(aimId: string) {
      const uiStore = useUIStore();

      try {
        const aim = this.aims[aimId]
        if (!aim) return

        // Get selection path to determine context
        const path = uiStore.getSelectionPath()

        // Determine deletion behavior based on selection path:
        // - path.aims.length > 1: Sub-aim (remove from parent's incoming)
        // - path.aims.length === 1 && phaseId exists: Committed aim (remove from phase)
        // - path.aims.length === 1 && no phaseId: Floating aim (delete entirely)

        if (path.aims.length > 1) {
          // B) Sub-aim: remove from parent aim's incoming list
          const parentAim = path.aims[path.aims.length - 2]
          if (parentAim) {
            await this.deleteSubAimRecursive(uiStore.projectPath, aimId, parentAim.id)

            // Adjust parent's selectedIncomingIndex to stay in valid range
            const updatedParentAim = this.aims[parentAim.id]
            if (updatedParentAim && updatedParentAim.selectedIncomingIndex !== undefined && updatedParentAim.incoming) {
                if (updatedParentAim.incoming.length > 0) {
                updatedParentAim.selectedIncomingIndex = Math.min(
                    updatedParentAim.selectedIncomingIndex,
                    updatedParentAim.incoming.length - 1
                )
                } else {
                updatedParentAim.selectedIncomingIndex = undefined
                }
            }
          }
        } else if (path.phase) {
          // A) Committed aim: remove from phase
          await trpc.aim.removeFromPhase.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId,
            phaseId: path.phase.id
          });

          // Reload the specific phase to get updated commitments
          const phase = await trpc.phase.get.query({ projectPath: uiStore.projectPath, phaseId: path.phase.id })
          if (phase) {
            this.replacePhase(path.phase.id, phase)
          }

          // Update aim's committedIn array
          // TODO implement aim removal server side, then reload parent aim/phase in client
          const updatedAim = this.aims[aimId]
          if (updatedAim) {
            updatedAim.committedIn = updatedAim.committedIn?.filter(id => id !== path.phase?.id) || []
          }
        } else {
          // C) Floating aim: delete entirely (including all sub-aims)
          // First recursively delete all sub-aims
          if (aim.incoming && aim.incoming.length > 0) {
            for (const childAimId of [...aim.incoming]) {
              await this.deleteSubAimRecursive(uiStore.projectPath, childAimId, aimId)
            }
          }

          // Then delete the aim itself
          await trpc.aim.delete.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId
          });

          delete this.aims[aimId]
          this.floatingAimsIds = this.floatingAimsIds.filter(id => id !== aimId)
        }

        // Adjust selection if needed
        if (uiStore.navigatingAims) {
          const aims = path.phase ? this.getAimsForPhase(path.phase.id) : this.floatingAims

          if (aims.length === 0) {
            uiStore.navigatingAims = false
          } else {
            // Select next/previous aim at same level
            if (!path.phase) {
              uiStore.floatingAimIndex = Math.min(uiStore.floatingAimIndex, aims.length - 1)
            } else {
              const phase = this.phases[path.phase.id]
              if (phase && phase.selectedAimIndex !== undefined) {
                phase.selectedAimIndex = Math.min(phase.selectedAimIndex, aims.length - 1)
              }
            }
          }
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to delete aim:', error);
      }
    },

    async loadPhaseAims(projectPath: string, phaseId: string) {
      if (!projectPath) return;

      try {
        if (phaseId === 'null') {
          // Root aims should use loadFloatingAims, this branch might be unused now but kept for safety
          await this.loadFloatingAims(projectPath);
        } else {
          // Phase aims - load the specific phase to get commitments
          const phase = await trpc.phase.get.query({ projectPath, phaseId });
          if (phase) {
            this.replacePhase(phaseId, phase);
            
            // NEW: Actually fetch the aims content for this phase!
            // We can fetch specifically aims committed to this phase
            const phaseAims = await trpc.aim.list.query({ 
              projectPath, 
              phaseId: phaseId 
            });
            
            for (const aim of phaseAims) {
              this.replaceAim(aim.id, aim);
            }
            this.recalculateValues();
          }
        }
      } catch (error) {
        console.error('Failed to load phase aims:', error);
      }
    },

    async loadAims(projectPath: string, aimIds: string[]) {
      if (!projectPath || aimIds.length === 0) return;
      
      // Always reload to ensure freshness, especially for deep path expansion
      // where we need the latest 'incoming' arrays.

      try {
        const aims = await trpc.aim.list.query({
          projectPath,
          ids: aimIds
        });

        for (const aim of aims) {
          this.replaceAim(aim.id, aim);
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to load specific aims:', error);
      }
    },

    async reorderPhaseAim(projectPath: string, phaseId: string, aimId: string, newIndex: number) {
      try {
        await trpc.aim.commitToPhase.mutate({
          projectPath,
          aimId,
          phaseId,
          insertionIndex: newIndex
        });
        
        const phase = await trpc.phase.get.query({ projectPath, phaseId });
        if (phase) this.replacePhase(phaseId, phase);
      } catch (error) {
        console.error('Failed to reorder phase aim:', error);
      }
    },

    async reorderSubAim(projectPath: string, parentAimId: string, childAimId: string, newIndex: number) {
      try {
        const childAim = this.aims[childAimId];
        const childSupportedAimsIndex = childAim?.supportedAims.indexOf(parentAimId) ?? 0;

        await trpc.aim.connectAims.mutate({
          projectPath,
          parentAimId,
          childAimId: childAimId,
          parentIncomingIndex: newIndex,
          childSupportedAimsIndex: childSupportedAimsIndex !== -1 ? childSupportedAimsIndex : undefined
        });

        const parentAim = await trpc.aim.get.query({ projectPath, aimId: parentAimId });
        if (parentAim) this.replaceAim(parentAimId, parentAim);
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to reorder sub-aim:', error);
      }
    }
  }
})