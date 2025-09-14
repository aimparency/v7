import { defineStore } from 'pinia'
import type { Phase, Aim } from 'shared'
import { trpc } from '../trpc'

export const useDataStore = defineStore('data', {
  state: () => ({
    // Multi-column navigation system
    phaseColumns: [] as Phase[][], // Array of column data
    selectedPhaseIndices: [] as number[], // Selected phase index in each column
    currentViewportStart: 0, // Index of leftmost visible column
    visibleColumnCount: 2, // How many columns to show (responsive)
    columnScrollPositions: [] as number[], // Scroll position for each column
    
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
        
        // Reset navigation state
        this.phaseColumns = []
        this.selectedPhaseIndices = []
        this.currentViewportStart = 0
        this.columnScrollPositions = []
        
        // Create null phase for first column
        const nullPhase = {
          id: 'null',
          name: 'Root',
          from: 0,
          to: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
          parent: null,
          commitments: [] // Will be populated with uncommitted aims
        }
        
        // Initialize first column with null phase
        this.phaseColumns[0] = [nullPhase]
        this.selectedPhaseIndices[0] = 0
        this.columnScrollPositions[0] = 0
        
        // Load children of null phase for second column
        await this.loadColumn(projectPath, 1, 'null')
      } catch (error) {
        console.error('Failed to load phases:', error)
        this.error = 'Failed to load phases'
        this.phaseColumns = []
        this.selectedPhaseIndices = []
      } finally {
        this.loading = false
      }
    },
    
    async loadColumn(projectPath: string, columnIndex: number, parentPhaseId: string | null) {
      try {
        let phases: Phase[]
        
        if (parentPhaseId === 'null') {
          // For null phase, show all root phases (parent: null)
          phases = await trpc.phase.list.query({
            projectPath,
            parentPhaseId: null
          })
        } else {
          // For regular phases, show their children
          phases = await trpc.phase.list.query({
            projectPath,
            parentPhaseId
          })
        }
        
        // Initialize column data
        this.phaseColumns[columnIndex] = phases
        this.selectedPhaseIndices[columnIndex] = 0
        this.columnScrollPositions[columnIndex] = 0
        
        // Clear any columns beyond this one
        this.phaseColumns.splice(columnIndex + 1)
        this.selectedPhaseIndices.splice(columnIndex + 1)
        this.columnScrollPositions.splice(columnIndex + 1)
        
      } catch (error) {
        console.error('Failed to load child phases:', error)
        this.phaseColumns[columnIndex] = []
        this.selectedPhaseIndices[columnIndex] = 0
        this.columnScrollPositions[columnIndex] = 0
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
    
    // Helper method to find a phase in any column
    findPhase(phaseId: string): Phase | undefined {
      for (const column of this.phaseColumns) {
        const found = column.find(p => p.id === phaseId)
        if (found) return found
      }
      return undefined
    },
    
    // Navigation methods
    async navigateRight(projectPath: string) {
      const currentColumnIndex = this.getCurrentFocusedColumnIndex()
      const selectedPhase = this.getSelectedPhase(currentColumnIndex)
      
      if (selectedPhase) {
        const nextColumnIndex = currentColumnIndex + 1
        await this.loadColumn(projectPath, nextColumnIndex, selectedPhase.id)
        
        // Only adjust viewport if we actually loaded phases
        const hasPhases = this.phaseColumns[nextColumnIndex]?.length > 0
        if (hasPhases && nextColumnIndex >= this.currentViewportStart + this.visibleColumnCount) {
          this.currentViewportStart = nextColumnIndex - this.visibleColumnCount + 1
        }
      }
    },
    
    navigateLeft() {
      if (this.currentViewportStart > 0) {
        this.currentViewportStart--
      }
    },
    
    // Get currently focused column index (rightmost visible column with data)
    getCurrentFocusedColumnIndex(): number {
      for (let i = this.phaseColumns.length - 1; i >= 0; i--) {
        if (this.phaseColumns[i] && this.phaseColumns[i].length > 0) {
          return i
        }
      }
      return 0
    },
    
    // Get selected phase from specific column
    getSelectedPhase(columnIndex: number): Phase | undefined {
      const column = this.phaseColumns[columnIndex]
      const selectedIndex = this.selectedPhaseIndices[columnIndex]
      return column?.[selectedIndex]
    },
    
    // Update selection in specific column
    setSelectedPhaseIndex(columnIndex: number, phaseIndex: number) {
      if (this.selectedPhaseIndices[columnIndex] !== undefined) {
        this.selectedPhaseIndices[columnIndex] = phaseIndex
      }
    },
    
    // Set responsive column count
    setVisibleColumnCount(count: number) {
      this.visibleColumnCount = Math.max(1, count)
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