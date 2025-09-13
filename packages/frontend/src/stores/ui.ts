import { defineStore } from 'pinia'

export const useUIStore = defineStore('ui', {
  state: () => ({
    // Project state
    projectPath: localStorage.getItem('aimparency-project-path') || '',
    connectionStatus: 'connecting' as 'connecting' | 'connected' | 'no connection',
    
    // Modal states
    showPhaseModal: false,
    newPhaseName: '',
    newPhaseStartDate: '',
    newPhaseEndDate: '',
    showAimModal: false,
    
    // Keyboard hints
    keyboardHints: [] as string[],
  }),
  
  getters: {
    isInProjectSelection: (state) => !state.projectPath,
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
    
    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
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
    
    // Keyboard hints actions
    setKeyboardHints(hints: string[]) {
      this.keyboardHints = hints
    },
    
  }
})