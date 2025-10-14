import { defineStore } from 'pinia'
import type { Phase, Aim } from 'shared'
import { trpc } from '../trpc'
import { useUIStore } from './ui'

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
      return childIds.map(id => state.phases[id]).filter(Boolean).sort((a, b) => a.from - b.from)
    },
    getAimsForPhase: (state) => (phaseId: string) => {
      if (phaseId === 'null') {
        // Root aims are not directly stored, compute them
        return Object.values(state.aims).filter(aim => !aim.committedIn || aim.committedIn.length === 0)
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
          uiStore.setSelectedPhase(columnIndex, newPhaseIndex, newPhaseId);
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
    
    async commitAimToPhase(projectPath: string, aimId: string, phaseId: string, insertionIndex?: number) {
      try {
        // Use the new backend endpoint that maintains bidirectional relationship
        await trpc.aim.commitToPhase.mutate({
          projectPath,
          aimId,
          phaseId,
          insertionIndex
        })

        // Update local state - reload the phase to get updated commitments
        await this.loadPhases(projectPath, null); // Reload all phases to ensure commitments are updated
        await this.loadAllAims(projectPath); // Reload all aims to ensure committedIn is updated
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

    async loadPhases(projectPath: string, parentId: string | null) {
      if (!projectPath) return;
      this.loading = true;
      try {
        const phases = await trpc.phase.list.query({ projectPath, parentPhaseId: parentId });
        const childIds: string[] = [];
        for (const phase of phases) {
          this.phases[phase.id] = phase;
          childIds.push(phase.id);
        }
        this.childrenByParentId[parentId ?? 'null'] = childIds;
      } catch (error) {
        this.error = 'Failed to load phases';
        console.error(this.error, error);
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

        // Reload phases
        if (parentPhaseId === null) {
          await this.loadPhases(uiStore.projectPath, null);
        } else {
          uiStore.triggerPhaseReload();
        }
      } catch (error) {
        console.error('Failed to delete phase:', error);
      }
    },

    async deleteAim(aimId: string, phaseId: string) {
      const uiStore = useUIStore();

      try {
        // Store the index of the aim being deleted for selection adjustment
        const deletedIndex = uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.aimIndex !== undefined
          ? uiStore.selectedAim.aimIndex
          : -1;

        if (phaseId === 'null') {
          // Root aims: delete entirely
          await trpc.aim.delete.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId
          });
        } else {
          // Phase aims: remove from phase only
          await trpc.aim.removeFromPhase.mutate({
            projectPath: uiStore.projectPath,
            aimId: aimId,
            phaseId: phaseId
          });
        }

        // Reload phase aims
        await this.loadPhaseAims(uiStore.projectPath, phaseId);

        // Reload root aims in case the aim became orphaned
        if (phaseId !== 'null') {
          await this.loadPhaseAims(uiStore.projectPath, 'null');
        }

        // Adjust selection if needed
        const aims = this.getAimsForPhase(phaseId);
        if (aims.length === 0) {
          // No more aims, exit phase-edit mode
          uiStore.setMode('column-navigation');
          uiStore.setSelectedAim(null, null);
        } else if (uiStore.selectedAim?.phaseId === phaseId) {
          // We were in this phase, adjust selection
          if (deletedIndex !== -1 && deletedIndex < aims.length) {
            // Deleted aim was not the last one, keep the same index
            uiStore.setSelectedAim(phaseId, deletedIndex);
          } else {
            // Deleted aim was the last one or selection was invalid, move to last valid
            uiStore.setSelectedAim(phaseId, Math.min(deletedIndex, aims.length - 1));
          }
          // Update last selected index
          if (phaseId === 'null') {
            uiStore.lastSelectedRootAimIndex = uiStore.selectedAim.aimIndex;
          } else {
            uiStore.lastSelectedAimIndexByPhase[phaseId] = uiStore.selectedAim.aimIndex;
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