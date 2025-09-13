import { defineStore } from 'pinia'

export type UIMode = 'project-selection' | 'column-navigation' | 'phase-edit' | 'aim-edit' | 'aim-adding'

export const useUIStore = defineStore('ui', {
  state: () => ({
    // Current UI mode
    mode: 'project-selection' as UIMode,
    
    // Project state
    projectPath: localStorage.getItem('aimparency-project-path') || '',
    connectionStatus: 'connecting' as 'connecting' | 'connected' | 'no connection',
    
    // Column navigation state
    focusedColumn: 'left' as 'left' | 'right',
    selectedPhaseIndex: 0,
    selectedRightPhaseIndex: 0,
    
    // Phase edit state
    selectedAimIndex: 0,
    expandedAims: new Set<string>(),
    
    // Modal states
    showPhaseModal: false,
    newPhaseName: '',
    newPhaseStartDate: '',
    newPhaseEndDate: '',
    showAimModal: false,
  }),
  
  getters: {
    isInProjectSelection: (state) => state.mode === 'project-selection',
    isInColumnNavigation: (state) => state.mode === 'column-navigation',
    isInPhaseEdit: (state) => state.mode === 'phase-edit',
    isInAimEdit: (state) => state.mode === 'aim-edit',
    isInAimAdding: (state) => state.mode === 'aim-adding',
  },
  
  actions: {
    setMode(mode: UIMode) {
      this.mode = mode
    },
    
    setProjectPath(path: string) {
      this.projectPath = path
      if (path) {
        localStorage.setItem('aimparency-project-path', path)
        this.mode = 'column-navigation'
      } else {
        localStorage.removeItem('aimparency-project-path')
        this.mode = 'project-selection'
      }
    },
    
    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
    },
    
    // Column navigation actions
    moveFocusLeft() {
      if (this.focusedColumn === 'right') {
        this.focusedColumn = 'left'
      }
    },
    
    moveFocusRight() {
      if (this.focusedColumn === 'left') {
        this.focusedColumn = 'right'
      }
    },
    
    movePhaseUp() {
      if (this.focusedColumn === 'left' && this.selectedPhaseIndex > 0) {
        this.selectedPhaseIndex--
        return true // Indicates we should reload right column
      } else if (this.focusedColumn === 'right' && this.selectedRightPhaseIndex > 0) {
        this.selectedRightPhaseIndex--
      }
      return false
    },
    
    movePhaseDown(maxIndex: number) {
      if (this.focusedColumn === 'left' && this.selectedPhaseIndex < maxIndex - 1) {
        this.selectedPhaseIndex++
        return true // Indicates we should reload right column
      } else if (this.focusedColumn === 'right' && this.selectedRightPhaseIndex < maxIndex - 1) {
        this.selectedRightPhaseIndex++
      }
      return false
    },
    
    enterPhaseEdit() {
      this.mode = 'phase-edit'
      this.selectedAimIndex = 0
    },
    
    exitPhaseEdit() {
      this.mode = 'column-navigation'
    },
    
    // Phase creation actions
    openPhaseModal() {
      this.showPhaseModal = true
      this.newPhaseName = ''
      this.newPhaseStartDate = ''
      this.newPhaseEndDate = ''
    },
    
    closePhaseModal() {
      this.showPhaseModal = false
      this.newPhaseName = ''
      this.newPhaseStartDate = ''
      this.newPhaseEndDate = ''
    },
    
    // Aim creation actions
    openAimModal() {
      this.showAimModal = true
    },
    
    closeAimModal() {
      this.showAimModal = false
    },
    
    // Aim navigation actions
    moveAimUp() {
      if (this.selectedAimIndex > 0) {
        this.selectedAimIndex--
      }
    },
    
    moveAimDown(maxIndex: number) {
      if (this.selectedAimIndex < maxIndex - 1) {
        this.selectedAimIndex++
      }
    },
    
    toggleAimExpanded(aimId: string) {
      if (this.expandedAims.has(aimId)) {
        this.expandedAims.delete(aimId)
      } else {
        this.expandedAims.add(aimId)
      }
    },
  }
})