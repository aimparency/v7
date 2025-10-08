import { defineStore } from 'pinia'
import type { Hint, KeyboardHints } from 'shared'
import type { Ref } from 'vue'

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

    // Phase reload trigger (increment to force reload)
    phaseReloadTrigger: 0,

    // Delete pending states (might move to component state)
    pendingDeletePhaseId: null as string | null,
    pendingDeleteAimIndex: null as number | null,

    // Keyboard hints stack
    keyboardHintsStack: [] as Array<Ref<Record<string, string>>>,
  }),
  
  getters: {
    isInProjectSelection: (state) => !state.projectPath,

    // Aggregate keyboard hints from stack (higher entries override lower)
    activeKeyboardHints(): Hint[] {
      const merged: Record<string, string> = {}

      // Bottom to top - higher entries override
      for (const hintsRef of this.keyboardHintsStack) {
        Object.assign(merged, hintsRef.value)
      }

      // Convert to Hint[] for display
      return Object.entries(merged).map(([key, action]) => ({
        key,
        action
      }))
    },
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

    // Keyboard hints stack
    registerKeyboardHints(hints: Ref<Record<string, string>>): () => void {
      this.keyboardHintsStack.push(hints)

      // Return unregister function
      return () => {
        const index = this.keyboardHintsStack.indexOf(hints)
        if (index > -1) {
          this.keyboardHintsStack.splice(index, 1)
        }
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
      this.pendingDeletePhaseId = null
      this.pendingDeleteAimIndex = null
    },

  }
})