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

        // Add to local state immediately for root aims
        if (this.phaseAims['null']) {
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
          this.phaseAims['null'].push(newAim)
        }

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

        // Remove from root aims if it was there
        if (this.phaseAims['null']) {
          this.phaseAims['null'] = this.phaseAims['null'].filter(a => a.id !== aimId)
        }

        // Local phase data updates are now handled by individual components
      } catch (error) {
        console.error('Failed to commit aim to phase:', error)
        throw error
      }
    },
    
    async deleteAim(projectPath: string, aimId: string) {
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

        // Check if aim is now orphaned (no committedIn relationships)
        const allAims = await trpc.aim.list.query({ projectPath })
        const aim = allAims.find(a => a.id === aimId)
        if (aim && (!aim.committedIn || aim.committedIn.length === 0)) {
          // Add to root aims if not already there
          if (this.phaseAims['null'] && !this.phaseAims['null'].find(a => a.id === aimId)) {
            this.phaseAims['null'].push(aim)
          }
        }

        // Remove from the phase's local state
        if (this.phaseAims[phaseId]) {
          this.phaseAims[phaseId] = this.phaseAims[phaseId].filter(a => a.id !== aimId)
        }
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
    }
  }
})