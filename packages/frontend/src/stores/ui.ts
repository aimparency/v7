import { defineStore } from 'pinia'
import type { Hint } from 'shared'
import { timestampToLocalDate, timestampToLocalTime } from 'shared'

export const useUIStore = defineStore('ui', {
  state: () => ({
    // Project state
    projectPath: localStorage.getItem('aimparency-project-path') || '',
    connectionStatus: 'connecting' as 'connecting' | 'connected' | 'no connection',
    projectHistory: JSON.parse(localStorage.getItem('aimparency-project-history') || '[]') as Array<{
      path: string
      lastOpened: number
      failedToLoad: boolean
    }>,

    // Modal states
    showPhaseModal: false,
    phaseModalMode: 'create' as 'create' | 'edit',
    phaseModalEditingPhaseId: null as string | null, // Track which phase is being edited
    newPhaseName: '',
    newPhaseStartDate: '',
    newPhaseStartTime: '',
    newPhaseEndDate: '',
    newPhaseEndTime: '',
    phaseModalColumnIndex: 0, // Track which column the modal was opened from
    phaseModalParentPhase: null as any, // Track the parent phase for new phase creation
    phaseModalSelectedIndex: 0, // Track selected phase index for date calculation
    showAimModal: false,
    aimModalMode: 'create' as 'create' | 'edit',
    aimModalEditingAimId: null as string | null, // Track which aim is being edited
    aimModalPhaseId: null as string | null, // Track phase to add aim to
    aimModalInsertionIndex: 0, // Track where to insert the aim

    // Navigation mode system
    mode: 'column-navigation' as 'column-navigation' | 'phase-edit' | 'aim-edit',

    // Column tracking for navigation
    rightmostColumnIndex: 1, // Track the rightmost (empty) column index
    focusedColumnIndex: 0, // Track which column is currently focused (deprecated - use selectedColumn)
    selectedColumn: 0, // Currently selected column (visual selection)

    // Phase selection by column
    selectedPhaseByColumn: {} as Record<number, number>, // columnIndex -> phaseIndex
    selectedPhaseIdByColumn: {} as Record<number, string>, // columnIndex -> phaseId
    phaseCountByColumn: {} as Record<number, number>, // columnIndex -> total phase count

    // Aim selection (only set when in phase-edit or aim-edit mode)
    selectedAim: null as { phaseId: string, aimIndex: number } | null,

    // Viewport for column scrolling
    viewportStart: 0, // Left edge of visible window
    viewportSize: 2, // Number of columns visible at once

    // Phase reload trigger (increment to force reload)
    phaseReloadTrigger: 0,

    // Delete pending states
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimIndex: null as number | null,

    // Remember last selected aim index for root aims
    lastSelectedRootAimIndex: 0,

    // Remember last selected aim index per phase
    lastSelectedAimIndexByPhase: {} as Record<string, number>,

    // Remember last selected sub-phase index per parent phase
    lastSelectedSubPhaseIndexByPhase: {} as Record<string, number>,

    // Keyboard hints
    keyboardHints: [] as Hint[],
  }),
  
  getters: {
    isInProjectSelection: (state) => !state.projectPath,
    canNavigateRight: (state) => state.focusedColumnIndex < state.rightmostColumnIndex,
    canNavigateLeft: (state) => state.focusedColumnIndex > 0,
  },
  
  actions: {
    setProjectPath(path: string) {
      this.projectPath = path
      if (path) {
        localStorage.setItem('aimparency-project-path', path)
      } else {
        localStorage.removeItem('aimparency-project-path')
      }
    },

    addProjectToHistory(path: string) {
      // Remove existing occurrences of this path
      this.projectHistory = this.projectHistory.filter(p => p.path !== path)

      // Add to top
      this.projectHistory.unshift({
        path,
        lastOpened: Date.now(),
        failedToLoad: false
      })

      // Limit to 30 entries
      this.projectHistory = this.projectHistory.slice(0, 30)

      // Save to localStorage
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    removeProjectFromHistory(path: string) {
      this.projectHistory = this.projectHistory.filter(p => p.path !== path)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    markProjectAsFailed(path: string) {
      const project = this.projectHistory.find(p => p.path === path)
      if (project) {
        project.failedToLoad = true
        localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
      }
    },

    clearProjectFailure(path: string) {
      const project = this.projectHistory.find(p => p.path === path)
      if (project) {
        project.failedToLoad = false
        localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
      }
    },
    
    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
    },
    
    // Phase creation/editing actions
    openPhaseModal(columnIndex: number = 0, parentPhase: any = null, selectedIndex: number = 0) {
      this.showPhaseModal = true
      this.phaseModalMode = 'create'
      this.phaseModalEditingPhaseId = null
      this.newPhaseName = ''
      this.phaseModalColumnIndex = columnIndex
      this.phaseModalParentPhase = parentPhase
      this.phaseModalSelectedIndex = selectedIndex

      // Set default dates based on context
      const now = new Date()
      const currentDate = now.toISOString().split('T')[0] // YYYY-MM-DD
      const currentTime = now.toTimeString().slice(0, 5) // HH:MM

      // Priority 1: Copy from currently selected phase
      if (this.selectedColumn > 0) {
        const selectedPhaseId = this.getSelectedPhaseId(this.selectedColumn)
        if (selectedPhaseId) {
          // We need to fetch the phase data to get its dates
          // For now, set a placeholder - the modal component will handle this
          this.newPhaseStartDate = currentDate
          this.newPhaseStartTime = currentTime
          this.newPhaseEndDate = currentDate
          this.newPhaseEndTime = currentTime
        }
      }

      // Priority 2: Copy from parent phase (one column to the left)
      if (!this.newPhaseStartDate && columnIndex > 1) {
        const parentColumn = columnIndex - 1
        const parentPhaseId = this.getSelectedPhaseId(parentColumn)
        if (parentPhaseId) {
          // We need to fetch the parent phase data to get its dates
          // For now, set a placeholder - the modal component will handle this
          this.newPhaseStartDate = currentDate
          this.newPhaseStartTime = currentTime
          this.newPhaseEndDate = currentDate
          this.newPhaseEndTime = currentTime
        }
      }

      // Priority 3: Default for root phases (column 1, "very first phase" scenario)
      if (!this.newPhaseStartDate) {
        // Current date 00:00 to current date + 7 days 00:00
        this.newPhaseStartDate = currentDate
        this.newPhaseStartTime = '00:00'
        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        this.newPhaseEndDate = sevenDaysLater.toISOString().split('T')[0]
        this.newPhaseEndTime = '00:00'
      }
    },

    openPhaseEditModal(phaseId: string, phaseName: string, phaseFrom: number, phaseTo: number, columnIndex: number = 0) {
      this.showPhaseModal = true
      this.phaseModalMode = 'edit'
      this.phaseModalEditingPhaseId = phaseId
      this.newPhaseName = phaseName

      // Extract local date and time from timestamps
      this.newPhaseStartDate = timestampToLocalDate(phaseFrom)
      this.newPhaseStartTime = timestampToLocalTime(phaseFrom)
      this.newPhaseEndDate = timestampToLocalDate(phaseTo)
      this.newPhaseEndTime = timestampToLocalTime(phaseTo)

      this.phaseModalColumnIndex = columnIndex
    },

    closePhaseModal() {
      this.showPhaseModal = false
      this.phaseModalMode = 'create'
      this.phaseModalEditingPhaseId = null
      this.newPhaseName = ''
      this.newPhaseStartDate = ''
      this.newPhaseStartTime = ''
      this.newPhaseEndDate = ''
      this.newPhaseEndTime = ''
      this.phaseModalParentPhase = null
      this.phaseModalSelectedIndex = 0
    },
    
    // Aim creation/editing actions
    openAimModal(phaseId: string | null = null, insertionIndex: number = 0) {
      this.showAimModal = true
      this.aimModalMode = 'create'
      this.aimModalEditingAimId = null
      this.aimModalPhaseId = phaseId
      this.aimModalInsertionIndex = insertionIndex
    },

    openAimEditModal(aimId: string, phaseId: string, aimIndex: number) {
      this.showAimModal = true
      this.aimModalMode = 'edit'
      this.aimModalEditingAimId = aimId
      this.aimModalPhaseId = phaseId
      this.aimModalInsertionIndex = aimIndex
    },

    closeAimModal() {
      this.showAimModal = false
      this.aimModalMode = 'create'
      this.aimModalEditingAimId = null
      this.aimModalPhaseId = null
      this.aimModalInsertionIndex = 0
    },
    
    // Keyboard hints actions
    setKeyboardHints(hints: Hint[]) {
      this.keyboardHints = hints
    },

    // Column tracking actions
    setRightmostColumn(columnIndex: number) {
      this.rightmostColumnIndex = columnIndex
    },

    setMinRightmost(columnIndex: number) {
      this.rightmostColumnIndex = Math.max(this.rightmostColumnIndex, columnIndex)
    },

    setFocusedColumn(columnIndex: number) {
      this.focusedColumnIndex = columnIndex
      this.selectedColumn = columnIndex
    },

    setSelectedColumn(columnIndex: number) {
      this.selectedColumn = columnIndex
      this.focusedColumnIndex = columnIndex
    },

    // Navigation mode actions
    setMode(mode: 'column-navigation' | 'phase-edit' | 'aim-edit') {
      this.mode = mode
    },

    setSelectedPhase(columnIndex: number, phaseIndex: number, phaseId?: string) {
      // Remember the previous selection for this column (if it was a sub-phase selection)
      if (columnIndex > 1 && this.selectedPhaseIdByColumn[columnIndex]) {
        const parentColumn = columnIndex - 1
        const parentPhaseId = this.selectedPhaseIdByColumn[parentColumn]
        if (parentPhaseId) {
          this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = this.selectedPhaseByColumn[columnIndex]
        }
      }

      this.selectedPhaseByColumn[columnIndex] = phaseIndex
      if (phaseId !== undefined) {
        this.selectedPhaseIdByColumn[columnIndex] = phaseId
      }

      // For sub-phase columns, also update the remembered selection for the current parent
      if (columnIndex > 1) {
        const parentColumn = columnIndex - 1
        const parentPhaseId = this.selectedPhaseIdByColumn[parentColumn]
        if (parentPhaseId) {
          this.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = phaseIndex
        }
      }
    },

    getSelectedPhase(columnIndex: number): number {
      return this.selectedPhaseByColumn[columnIndex] ?? 0
    },

    getSelectedPhaseId(columnIndex: number): string | null {
      return this.selectedPhaseIdByColumn[columnIndex] ?? null
    },

    setPhaseCount(columnIndex: number, count: number) {
      this.phaseCountByColumn[columnIndex] = count
    },

    getPhaseCount(columnIndex: number): number {
      return this.phaseCountByColumn[columnIndex] ?? 0
    },

    setSelectedAim(phaseId: string | null, aimIndex: number | null) {
      if (phaseId === null || aimIndex === null) {
        this.selectedAim = null
      } else {
        this.selectedAim = { phaseId, aimIndex }
      }
    },

    // Navigation with edge-triggered viewport scrolling
    navigateLeft() {
      const currentIndex = this.selectedColumn

      // Boundary check: can't go left of column 0
      if (currentIndex === 0) return

      // Clear pending delete when navigating
      this.clearPendingDelete()

      // Edge-triggered viewport scroll
      if (currentIndex === this.viewportStart && this.viewportStart > 0) {
        this.viewportStart--
      }

      // Move selection
      this.selectedColumn = currentIndex - 1
      this.focusedColumnIndex = currentIndex - 1 // Keep in sync for now

      // Clear selectedAim when leaving root aims column
      if (this.selectedColumn !== 0) {
        this.setSelectedAim(null, null)
      }
    },

    navigateRight() {
      const currentIndex = this.selectedColumn

      // Boundary check: can't go right beyond empty column
      if (currentIndex >= this.rightmostColumnIndex) return

      // Clear pending delete when navigating
      this.clearPendingDelete()

      // Edge-triggered viewport scroll
      const viewportEnd = this.viewportStart + this.viewportSize - 1
      if (currentIndex === viewportEnd) {
        const maxViewportStart = Math.max(0, this.rightmostColumnIndex - this.viewportSize + 1)
        if (this.viewportStart < maxViewportStart) {
          this.viewportStart++
        }
      }

      // Move selection
      this.selectedColumn = currentIndex + 1
      this.focusedColumnIndex = currentIndex + 1 // Keep in sync for now

      // Clear selectedAim when leaving root aims column
      if (this.selectedColumn !== 0) {
        this.setSelectedAim(null, null)
      }
    },

    triggerPhaseReload() {
      this.phaseReloadTrigger++
    },

    setPendingDeletePhase(phaseId: string | null) {
      this.pendingDeletePhaseId = phaseId
    },

    setPendingDeleteAim(aimIndex: number | null) {
      this.pendingDeleteAimIndex = aimIndex
    },

    clearPendingDelete() {
      // Remember last selected aim index before clearing
      if (this.selectedAim) {
        if (this.selectedAim.phaseId === 'null') {
          this.lastSelectedRootAimIndex = this.selectedAim.aimIndex
        } else {
          this.lastSelectedAimIndexByPhase[this.selectedAim.phaseId] = this.selectedAim.aimIndex
        }
      }
      this.pendingDeletePhaseId = null
      this.pendingDeleteAimIndex = null
      // Don't clear selectedAim here - only clear it when actually deleting or when leaving phase-edit mode
    },

  }
})