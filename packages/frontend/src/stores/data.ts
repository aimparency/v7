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
      return Object.values(state.aims).filter(aim =>
        (!aim.committedIn || aim.committedIn.length === 0) &&
        (!aim.outgoing || aim.outgoing.length === 0)
      )
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
      const selectedAimIndex = oldPhase?.selectedAimIndex
      this.phases[phaseId] = newPhase as Phase
      if (selectedAimIndex !== undefined) {
        this.phases[phaseId].selectedAimIndex = selectedAimIndex
      }
    },

    // Helper to replace aim while preserving UI-only properties
    replaceAim(aimId: string, newAim: BaseAim) {
      const oldAim = this.aims[aimId]
      const expanded = oldAim?.expanded
      const selectedIncomingIndex = oldAim?.selectedIncomingIndex
      this.aims[aimId] = newAim as Aim
      if (expanded !== undefined) {
        this.aims[aimId].expanded = expanded
      }
      if (selectedIncomingIndex !== undefined) {
        this.aims[aimId].selectedIncomingIndex = selectedIncomingIndex
      }
    },

    async createAim(projectPath: string, aim: Omit<Aim, 'id'>): Promise<{id: string}> {
      try {
        const result = await trpc.aim.create.mutate({
          projectPath,
          aim
        })

        // Add to local state immediately
        const newAim: Aim = {
          id: result.id,
          text: aim.text,
          incoming: aim.incoming || [],
          outgoing: aim.outgoing || [],
          committedIn: aim.committedIn || [],
          status: aim.status || {
            state: 'open',
            comment: '',
            date: Date.now()
          }
        }
        this.aims[result.id] = newAim

        return result // Returns { id: string }
      } catch (error) {
        console.error('Failed to create aim:', error)
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
      if (!projectPath) return;
      // Avoid re-fetching if aims are already loaded
      if (Object.keys(this.aims).length > 0) return;

      this.loading = true;
      try {
        const allAims = await trpc.aim.list.query({ projectPath });
        for (const aim of allAims) {
          this.replaceAim(aim.id, aim);
        }
      } catch (error) {
        this.error = 'Failed to load aims';
        console.error(this.error, error);
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

        // Load all initial data from the stores
        await this.loadAllAims(projectPath);
        await this.loadPhases(projectPath, null); // Load root phases

        uiStore.setConnectionStatus('connected');
        uiStore.addProjectToHistory(projectPath);
        uiStore.clearProjectFailure(projectPath);
      } catch (error) {
        console.error('Failed to load project:', error);
        uiStore.setConnectionStatus('no connection');
        uiStore.markProjectAsFailed(projectPath);
      }
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
        const path = uiStore.getSelectionPath(this)

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
        } else if (path.phaseId) {
          // A) Committed aim: remove from phase
          await trpc.aim.removeFromPhase.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId,
            phaseId: path.phaseId
          });

          // Reload the specific phase to get updated commitments
          const phase = await trpc.phase.get.query({ projectPath: uiStore.projectPath, phaseId: path.phaseId })
          if (phase) {
            this.replacePhase(path.phaseId, phase)
          }

          // Update aim's committedIn array
          const updatedAim = this.aims[aimId]
          if (updatedAim) {
            updatedAim.committedIn = updatedAim.committedIn?.filter(id => id !== path.phaseId) || []
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
        }

        // Adjust selection if needed
        if (uiStore.navigatingAims) {
          const aims = path.phaseId ? this.getAimsForPhase(path.phaseId) : this.floatingAims

          if (aims.length === 0) {
            uiStore.navigatingAims = false
          } else {
            // Select next/previous aim at same level
            if (!path.phaseId) {
              uiStore.floatingAimIndex = Math.min(uiStore.floatingAimIndex, aims.length - 1)
            } else {
              const phase = this.phases[path.phaseId]
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
          // Root aims - load all aims and filter
          await this.loadAllAims(projectPath);
        } else {
          // Phase aims - load the specific phase to get commitments
          const phase = await trpc.phase.get.query({ projectPath, phaseId });
          if (phase) {
            this.replacePhase(phaseId, phase);
            // Aims are already loaded in loadAllAims, so commitments will work
          }
        }
      } catch (error) {
        console.error('Failed to load phase aims:', error);
      }
    }
  }
})