import { defineStore } from 'pinia'
import type { Phase, Aim } from 'shared'
import { trpc } from '../trpc'

export const useDataStore = defineStore('data', {
  state: () => ({
    leftColumnPhases: [] as Phase[],
    rightColumnPhases: [] as Phase[],
    phaseAims: {} as Record<string, Aim[]>,
    loading: false,
    error: null as string | null,
    migrated: false, // Track if we've run the migration
  }),
  
  actions: {
    async loadPhases(projectPath: string) {
      if (!projectPath) return
      
      this.loading = true
      this.error = null
      
      try {
        // Run migration once per session if not already done
        if (!this.migrated) {
          try {
            await trpc.project.migrateCommittedIn.mutate({ projectPath })
            this.migrated = true
          } catch (error) {
            console.warn('Migration failed, continuing anyway:', error)
          }
        }
        
        // Load root phases (parent: null) for left column
        const rootPhases = await trpc.phase.list.query({ 
          projectPath,
          parentPhaseId: null 
        })
        
        // Always include the null phase as the first item
        const nullPhase = {
          id: 'null',
          name: 'Root',
          from: 0,
          to: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
          parent: null,
          commitments: [] // Will be populated with uncommitted aims
        }
        
        this.leftColumnPhases = [nullPhase]
        
        // Load children of first selected phase for right column
        await this.loadRightColumn(projectPath, 0)
      } catch (error) {
        console.error('Failed to load phases:', error)
        this.error = 'Failed to load phases'
        this.leftColumnPhases = []
        this.rightColumnPhases = []
      } finally {
        this.loading = false
      }
    },
    
    async loadRightColumn(projectPath: string, selectedPhaseIndex: number) {
      if (selectedPhaseIndex < this.leftColumnPhases.length) {
        const selectedPhase = this.leftColumnPhases[selectedPhaseIndex]
        try {
          if (selectedPhase.id === 'null') {
            // For null phase, show all root phases (parent: null) on the right
            const rootPhases = await trpc.phase.list.query({
              projectPath,
              parentPhaseId: null
            })
            this.rightColumnPhases = rootPhases
          } else {
            // For regular phases, show their children
            const childPhases = await trpc.phase.list.query({
              projectPath,
              parentPhaseId: selectedPhase.id
            })
            this.rightColumnPhases = childPhases
          }
        } catch (error) {
          console.error('Failed to load child phases:', error)
          this.rightColumnPhases = []
        }
      } else {
        this.rightColumnPhases = []
      }
    },
    
    async createPhase(projectPath: string, phase: Omit<Phase, 'id'>) {
      try {
        await trpc.phase.create.mutate({
          projectPath,
          phase
        })
        
        // Reload phases after creation
        await this.loadPhases(projectPath)
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
          // For regular phases, load aims that are committed to this phase
          const phase = this.findPhase(phaseId)
          
          if (phase) {
            // Preserve the order from phase.commitments array
            this.phaseAims[phaseId] = phase.commitments.map(commitmentId => 
              allAims.find(aim => aim.id === commitmentId)
            ).filter(aim => aim !== undefined) // Remove any missing aims
          } else {
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
    
    // Helper method to find a phase in either column
    findPhase(phaseId: string): Phase | undefined {
      return this.leftColumnPhases.find(p => p.id === phaseId) || 
             this.rightColumnPhases.find(p => p.id === phaseId)
    },
    
    async createAim(projectPath: string, aim: Omit<Aim, 'id'>): Promise<{id: string}> {
      try {
        const result = await trpc.aim.create.mutate({
          projectPath,
          aim
        })
        
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
        
        // Update the local phase data to reflect the new commitments
        const localPhase = this.findPhase(phaseId)
        if (localPhase && !localPhase.commitments.includes(aimId)) {
          if (insertionIndex !== undefined && insertionIndex <= localPhase.commitments.length) {
            localPhase.commitments.splice(insertionIndex, 0, aimId)
          } else {
            localPhase.commitments.push(aimId)
          }
        }
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
        
        // Update the local phase data to reflect the new commitments
        const localPhase = this.findPhase(phaseId)
        if (localPhase) {
          localPhase.commitments = localPhase.commitments.filter(id => id !== aimId)
        }
      } catch (error) {
        console.error('Failed to remove aim from phase:', error)
        throw error
      }
    }
  }
})