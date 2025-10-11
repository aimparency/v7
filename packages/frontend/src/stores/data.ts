import { defineStore } from 'pinia'
import type { Phase, Aim } from 'shared'
import { trpc } from '../trpc'

export const useDataStore = defineStore('data', {
  state: () => ({
    // Simplified state - no more multi-column management
    phaseAims: {} as Record<string, Aim[]>,
    loading: false,
    error: null as string | null,
    migrated: false, // Track if we've run the migration
  }),
  
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
    
    // Removed loadColumn - now handled by individual Phase components
    
    async createPhase(projectPath: string, phase: Omit<Phase, 'id'>) {
      try {
        await trpc.phase.create.mutate({
          projectPath,
          phase
        })
      } catch (error) {
        console.error('Failed to create phase:', error)
        this.error = 'Failed to create phase'
        throw error
      }
    },
    
    async loadPhaseAims(projectPath: string, phaseId: string) {
      try {
        const allAims = await trpc.aim.list.query({ projectPath })

        if (phaseId === 'null') {
          // For the Root phase, load aims that aren't committed to any phase
          this.phaseAims[phaseId] = allAims.filter(aim =>
            !aim.committedIn || aim.committedIn.length === 0
          )
        } else {
          // For regular phases, load the phase data and its committed aims
          try {
            const phase = await trpc.phase.get.query({ projectPath, phaseId })

            if (phase) {
              // Preserve the order from phase.commitments array
              this.phaseAims[phaseId] = phase.commitments.map(commitmentId =>
                allAims.find(aim => aim.id === commitmentId)
              ).filter(aim => aim !== undefined) // Remove any missing aims
            } else {
              this.phaseAims[phaseId] = []
            }
          } catch (phaseError) {
            console.error('Failed to load phase:', phaseError)
            this.phaseAims[phaseId] = []
          }
        }
      } catch (error) {
        console.error('Failed to load phase aims:', error)
        this.phaseAims[phaseId] = []
      }
    },
    
    getPhaseAims(phaseId: string): Aim[] {
      return this.phaseAims[phaseId] || []
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
    }
  }
})