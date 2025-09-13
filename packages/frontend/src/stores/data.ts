import { defineStore } from 'pinia'
import type { Phase, Aim } from 'shared'
import { trpc } from '../trpc'

export const useDataStore = defineStore('data', {
  state: () => ({
    leftColumnPhases: [] as Phase[],
    rightColumnPhases: [] as Phase[],
    currentPhaseAims: [] as Aim[],
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
        
        this.leftColumnPhases = [nullPhase, ...rootPhases]
        
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
        // TODO: Load aims that are committed to this phase
        // For now, load all aims and filter by commitments
        const allAims = await trpc.aim.list.query({ projectPath })
        const phase = this.leftColumnPhases.find(p => p.id === phaseId) || 
                    this.rightColumnPhases.find(p => p.id === phaseId)
        
        if (phase) {
          this.currentPhaseAims = allAims.filter(aim => 
            phase.commitments.includes(aim.id)
          )
        } else {
          this.currentPhaseAims = []
        }
      } catch (error) {
        console.error('Failed to load phase aims:', error)
        this.currentPhaseAims = []
      }
    },
    
    async createAim(projectPath: string, aim: Omit<Aim, 'id'>) {
      try {
        await trpc.aim.create.mutate({
          projectPath,
          aim
        })
        
        // Reload current phase aims if we're in phase edit mode
        // This would need to be coordinated with UI store
      } catch (error) {
        console.error('Failed to create aim:', error)
        throw error
      }
    }
  }
})