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
  }),
  
  actions: {
    async loadPhases(projectPath: string) {
      if (!projectPath) return
      
      this.loading = true
      this.error = null
      
      try {
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
          // For the Root phase, load aims with no outgoing relationships
          this.phaseAims[phaseId] = allAims.filter(aim => 
            aim.outgoing.length === 0
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
        // Get the current phase
        const phase = await trpc.phase.get.query({
          projectPath,
          phaseId
        })
        
        // Add the aim ID to the commitments array if it's not already there
        if (!phase.commitments.includes(aimId)) {
          let updatedCommitments: string[]
          
          if (insertionIndex !== undefined) {
            // Insert at specific position
            updatedCommitments = [...phase.commitments]
            updatedCommitments.splice(insertionIndex, 0, aimId)
          } else {
            // Append to end
            updatedCommitments = [...phase.commitments, aimId]
          }
          
          await trpc.phase.update.mutate({
            projectPath,
            phaseId,
            phase: {
              commitments: updatedCommitments
            }
          })
          
          // Update the local phase data to reflect the new commitments
          const phase = this.findPhase(phaseId)
          if (phase) {
            phase.commitments = updatedCommitments
          }
        }
      } catch (error) {
        console.error('Failed to commit aim to phase:', error)
        throw error
      }
    }
  }
})