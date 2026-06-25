import { defineStore } from 'pinia'
import type { Hint } from 'shared'
import {
  normalizeProjectPath,
  removeProjectFromHistoryEntries,
  setProjectFailureState,
  upsertProjectHistory,
  type ProjectHistoryEntry
} from './ui/project-helpers'

function getInitialProjectPath(): string {
  const urlParams = new URLSearchParams(window.location.search)
  const pathFromUrl = urlParams.get('project') || urlParams.get('path')
  if (pathFromUrl) return pathFromUrl
  return ''
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    projectPath: getInitialProjectPath(),
    connectionStatus: 'connecting' as 'connecting' | 'connected' | 'no connection',
    projectHistory: JSON.parse(localStorage.getItem('aimparency-project-history') || '[]') as ProjectHistoryEntry[],
    currentView: 'columns' as 'columns' | 'graph' | 'voice',
    showWatchdog: localStorage.getItem('aimparency-show-watchdog') === 'true',
    watchdogMaximized: false,
    // Terminal-only mode: hides ALL chrome (both headers, tabs, footer) and
    // renders just the active terminal full-bleed, with a floating exit button.
    // Persisted so a reload restores the fullscreen session view (see App.vue watch).
    terminalFullscreen: localStorage.getItem('aimparency-terminal-fullscreen') === 'true',
    keyboardHints: [] as Hint[]
  }),

  getters: {
    isInProjectSelection: (state) => !state.projectPath
  },

  actions: {
    setProjectPath(path: string) {
      const cleanPath = normalizeProjectPath(path)
      this.projectPath = cleanPath
      if (cleanPath) {
        localStorage.setItem('aimparency-project-path', cleanPath)
        const url = new URL(window.location.href)
        url.searchParams.set('project', cleanPath)
        window.history.replaceState({}, '', url)
      } else {
        localStorage.removeItem('aimparency-project-path')
        const url = new URL(window.location.href)
        url.searchParams.delete('project')
        url.searchParams.delete('path')
        window.history.replaceState({}, '', url)
      }
    },

    addProjectToHistory(path: string) {
      this.projectHistory = upsertProjectHistory(this.projectHistory, path, Date.now())
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    removeProjectFromHistory(path: string) {
      this.projectHistory = removeProjectFromHistoryEntries(this.projectHistory, path)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    markProjectAsFailed(path: string) {
      this.projectHistory = setProjectFailureState(this.projectHistory, path, true)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    clearProjectFailure(path: string) {
      this.projectHistory = setProjectFailureState(this.projectHistory, path, false)
      localStorage.setItem('aimparency-project-history', JSON.stringify(this.projectHistory))
    },

    setConnectionStatus(status: typeof this.connectionStatus) {
      this.connectionStatus = status
    },

    setCurrentView(view: 'columns' | 'graph' | 'voice') {
      this.currentView = view
    },

    setKeyboardHints(hints: Hint[]) {
      this.keyboardHints = hints
    }
  }
})
