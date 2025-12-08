import { defineStore } from 'pinia'
import type { Phase as BasePhase, Aim as BaseAim } from 'shared'
import { trpc } from '../trpc'
import { useUIStore } from './ui'

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
  }),

  getters: {
    getPhasesByParentId: (state) => (parentId: string | null) => {
      const key = parentId ?? 'null'
      const childIds = state.childrenByParentId[key] || []
      return childIds.map(id => state.phases[id]).filter(Boolean).sort((a, b) => {
        // Sort by midpoint (average of start and end)
        const aMid = (a.from + a.to) / 2
        const bMid = (b.from + b.to) / 2
        return aMid - bMid
      })
    },
    floatingAims(state) {
      return state.floatingAimsIds.map(id => state.aims[id]).filter(Boolean);
    }, 
    getFloatingAimByIndex() { 
      return (index: number) => this.floatingAims[index]
    }, 
    getAimsForPhase: (state) => (phaseId: string) => {
      const phase = state.phases[phaseId]
      if (!phase) return []
      return phase.commitments.map(aimId => state.aims[aimId]).filter(Boolean)
    },
  },

  actions: {
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
      } catch (error) {
        console.error('Failed to load floating aims:', error);
      } finally {
        this.loading = false;
      }
    },

    async runMigration(projectPath: string) {
      if (!projectPath || this.migrated) return

      try {
        await trpc.project.migrateCommittedIn.mutate({ projectPath })
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
      const newPhaseIndex = newPhases.findIndex(p => p.id === newPhaseId);

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

      // Replace with new data
      this.aims[aimId] = Object.assign({
        expanded: false,
        selectedIncomingIndex: undefined
      }, newAim) as Aim

      // Restore validated UI state
      this.aims[aimId].expanded = oldExpanded

      if (oldSelectedIndex !== undefined && newAim.incoming.length > 0) {
        const maxIndex = newAim.incoming.length - 1
        if (oldSelectedIndex <= maxIndex) {
          this.aims[aimId].selectedIncomingIndex = oldSelectedIndex
        } else {
          // Index out of bounds - clamp to last valid index
          console.warn(`Selection index ${oldSelectedIndex} out of bounds (max ${maxIndex}) for aim ${aimId}, clamping to ${maxIndex}`)
          this.aims[aimId].selectedIncomingIndex = maxIndex
        }
      }
    },

    async createFloatingAim(projectPath: string, aim: Omit<Aim, 'id' | 'incoming' | 'outgoing' | 'committedIn'>): Promise<{id: string}> {
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

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create aim:', error)
        throw error
      }
    },

    async createSubAim(projectPath: string, parentAimId: string, aim: Omit<Aim, 'id' | 'incoming' | 'outgoing' | 'committedIn'>, positionInParent?: number): Promise<{id: string}> {
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

        // Reload child aim to get updated outgoing array
        // This ensures it doesn't appear in floating aims
        const updatedChildAim = await trpc.aim.get.query({ projectPath, aimId: newAim.id })
        if (updatedChildAim) {
          this.replaceAim(newAim.id, updatedChildAim)
        }

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create sub-aim:', error)
        throw error
      }
    }, 

    async createCommittedAim(projectPath: string, phaseId: string, aim: Omit<Aim, 'id' | 'incoming' | 'outgoing' | 'committedIn'>, insertionIndex?: number): Promise<{id: string}> {
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
      } catch (error) {
        console.error('Failed to update aim:', error)
        throw error
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
      // Deprecated: Prefer on-demand loading. 
      // Currently only used to pre-populate cache if needed, but floating aims are now paginated.
      // We will leave it as no-op or load only phases if we want to ensure commitments are valid?
      // For now, let's just return.
      return; 
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
             } catch (e) {
               if (this.aims[data.id]) delete this.aims[data.id];
             }
          } else if (data.type === 'phase') {
             try {
               const phase = await trpc.phase.get.query({ projectPath, phaseId: data.id });
               this.replacePhase(phase.id, phase);
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
      if (parentAim) {
        const wasExpanded = parentAim.expanded
        const updatedIncoming = parentAim.incoming.filter(id => id !== aimId)
        await this.updateAim(projectPath, parentAimId, {
          incoming: updatedIncoming
        })
        // Restore expanded state (it's UI-only, not persisted)
        if (wasExpanded) {
          this.aims[parentAimId].expanded = true
        }
      }

      // 3. Remove the parent from this aim's outgoing array
      const updatedOutgoing = aim.outgoing.filter(id => id !== parentAimId)

      // 4. If this aim has no other parents (outgoing connections), delete it completely
      if (updatedOutgoing.length === 0) {
        await trpc.aim.delete.mutate({
          projectPath,
          aimId: aimId
        })
        delete this.aims[aimId]
      } else {
        // Still has other parents, just update the outgoing array
        await this.updateAim(projectPath, aimId, {
          outgoing: updatedOutgoing
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
          await this.deleteSubAimRecursive(uiStore.projectPath, aimId, parentAim.id)

          // Adjust parent's selectedIncomingIndex to stay in valid range
          const updatedParentAim = this.aims[parentAim.id]
          if (updatedParentAim && updatedParentAim.selectedIncomingIndex !== undefined) {
            if (updatedParentAim.incoming.length > 0) {
              updatedParentAim.selectedIncomingIndex = Math.min(
                updatedParentAim.selectedIncomingIndex,
                updatedParentAim.incoming.length - 1
              )
            } else {
              updatedParentAim.selectedIncomingIndex = undefined
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
        const childOutgoingIndex = childAim?.outgoing.indexOf(parentAimId) ?? 0;

        await trpc.aim.connectAims.mutate({
          projectPath,
          parentAimId,
          childAimId: childAimId,
          parentIncomingIndex: newIndex,
          childOutgoingIndex: childOutgoingIndex !== -1 ? childOutgoingIndex : undefined
        });

        const parentAim = await trpc.aim.get.query({ projectPath, aimId: parentAimId });
        if (parentAim) this.replaceAim(parentAimId, parentAim);
      } catch (error) {
        console.error('Failed to reorder sub-aim:', error);
      }
    }
  }
})