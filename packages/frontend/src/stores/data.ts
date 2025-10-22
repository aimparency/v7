import { defineStore } from 'pinia'
import type { Phase as BasePhase, Aim as BaseAim } from 'shared'
import { trpc } from '../trpc'
import { useUIStore } from './ui'

// Extend Phase type with UI-only properties
export type Phase = BasePhase & {
  selectedAimIndex?: number
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
    getAimsForPhase: (state) => (phaseId: string) => {
      if (phaseId === 'null') {
        // Root aims: uncommitted aims with no outgoing aims (not sub-aims)
        return Object.values(state.aims).filter(aim =>
          (!aim.committedIn || aim.committedIn.length === 0) &&
          (!aim.outgoing || aim.outgoing.length === 0)
        )
      }
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
        this.aims[aimId] = updatedAim
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
          // Preserve UI-only properties
          const oldPhase = this.phases[phaseId]
          const selectedAimIndex = oldPhase?.selectedAimIndex
          this.phases[phaseId] = phase
          if (selectedAimIndex !== undefined) {
            this.phases[phaseId].selectedAimIndex = selectedAimIndex
          }
        }

        // Reload the aim to get updated committedIn field
        const aim = await trpc.aim.get.query({ projectPath, aimId })
        if (aim) {
          this.aims[aimId] = aim
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
          this.phases[phase.id] = phase;
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
          this.aims[aim.id] = aim;
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

    async deleteAim(aimId: string, phaseId: string) {
      const uiStore = useUIStore();

      try {
        // Get the deleted index based on current selection
        let deletedIndex = -1
        if (uiStore.mode === 'aims-edit') {
          if (phaseId === 'null') {
            deletedIndex = uiStore.rootAimsSelectedIndex
          } else {
            const phase = this.phases[phaseId]
            deletedIndex = phase?.selectedAimIndex ?? -1
          }
        }

        // Get the aim to check if it's a sub-aim
        const aim = this.aims[aimId]
        const isSubAim = aim && aim.outgoing && aim.outgoing.length > 0

        if (isSubAim) {
          // Sub-aim: recursively delete it and all its children
          const parentAimId = aim.outgoing[0]!
          const parentAim = this.aims[parentAimId]
          const deletedSubIndex = parentAim?.incoming.indexOf(aimId) ?? -1

          await this.deleteSubAimRecursive(uiStore.projectPath, aimId, parentAimId)

          // Adjust parent's selectedIncomingIndex to stay in valid range
          const updatedParentAim = this.aims[parentAimId]
          if (updatedParentAim && updatedParentAim.selectedIncomingIndex !== undefined) {
            if (updatedParentAim.incoming.length > 0) {
              // Clamp to valid range - this naturally selects next aim or previous if was last
              updatedParentAim.selectedIncomingIndex = Math.min(
                updatedParentAim.selectedIncomingIndex,
                updatedParentAim.incoming.length - 1
              )
            } else {
              // No sub-aims left, clear selection index
              updatedParentAim.selectedIncomingIndex = undefined
            }
          }
          return // Skip top-level selection logic
        } else if (phaseId === 'null') {
          // Root aims: delete entirely (including all sub-aims)
          // First recursively delete all incoming aims
          if (aim && aim.incoming && aim.incoming.length > 0) {
            for (const childAimId of [...aim.incoming]) {
              await this.deleteSubAimRecursive(uiStore.projectPath, childAimId, aimId)
            }
          }

          // Then delete the root aim itself
          await trpc.aim.delete.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId
          });

          // Force reload all aims by clearing cache first
          delete this.aims[aimId]
        } else {
          // Phase aims: remove from phase only
          await trpc.aim.removeFromPhase.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId,
            phaseId: phaseId
          });

          // Reload the specific phase to get updated commitments
          const phase = await trpc.phase.get.query({ projectPath: uiStore.projectPath, phaseId })
          if (phase) {
            this.phases[phaseId] = phase
          }
          // Also remove the aim from local aims cache if it became orphaned
          const updatedAim = this.aims[aimId]
          if (updatedAim && (!updatedAim.committedIn || updatedAim.committedIn.length === 0)) {
            // This aim is now a root aim, keep it but mark as uncommitted
            updatedAim.committedIn = []
          }
        }

        // Adjust selection if needed
        const aims = this.getAimsForPhase(phaseId);
        if (aims.length === 0) {
          // No more aims, exit aims-edit mode
          uiStore.setMode('column-navigation');
        } else if (uiStore.mode === 'aims-edit' && deletedIndex !== -1) {
          // Select aim: same index, or last if deleted was last
          const newIndex = Math.min(deletedIndex, aims.length - 1);

          // Update the appropriate index
          if (phaseId === 'null') {
            uiStore.rootAimsSelectedIndex = newIndex;
          } else {
            const phase = this.phases[phaseId]
            if (phase) {
              phase.selectedAimIndex = newIndex;
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
            this.phases[phaseId] = phase;
            // Aims are already loaded in loadAllAims, so commitments will work
          }
        }
      } catch (error) {
        console.error('Failed to load phase aims:', error);
      }
    }
  }
})