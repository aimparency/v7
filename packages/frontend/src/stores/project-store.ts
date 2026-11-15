import { defineStore } from 'pinia'
import { isGraphSlug, type Hint } from 'shared'
import {
  normalizeProjectPath,
  removeProjectFromHistoryEntries,
  setProjectFailureState,
  upsertProjectHistory,
  type ProjectHistoryEntry
} from './ui/project-helpers'
import { hasAccounts } from '../utils/runtime-config'

// ?repo=<git url>: a shareable link to someone else's project. It wins over
// ?project= (the local clone) so a reload fetches the latest commit.
export function getRepoUrlParam(): string {
  return new URLSearchParams(window.location.search).get('repo') ?? ''
}

export function setRepoUrlParam(repoUrl: string) {
  const url = new URL(window.location.href)
  if (repoUrl) url.searchParams.set('repo', repoUrl)
  else url.searchParams.delete('repo')
  window.history.replaceState({}, '', url)
}

// /spaces/<slug>: a graph of this server.
function graphSlugFromLocation(): string {
  const slug = /^\/spaces\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? ''
  return isGraphSlug(slug) ? slug : ''
}

function getInitialProjectPath(): string {
  const slug = graphSlugFromLocation()
  if (slug) return slug
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.get('repo')) return ''
  const pathFromUrl = urlParams.get('project') || urlParams.get('path')
  if (pathFromUrl) return pathFromUrl
  return ''
}

// Without login the person at the machine runs agents and loops.
const localTools = () => !hasAccounts()

export const useProjectStore = defineStore('project', {
  state: () => ({
    projectPath: getInitialProjectPath(),
    connectionStatus: 'connecting' as 'connecting' | 'connected' | 'no connection',
    projectHistory: JSON.parse(localStorage.getItem('aimparency-project-history') || '[]') as ProjectHistoryEntry[],
    currentView: 'columns' as 'columns' | 'graph' | 'voice',
    showWatchdog: localTools() && localStorage.getItem('aimparency-show-watchdog') === 'true',
    watchdogMaximized: false,
    // Never both: the watchdog wins when both were left open.
    showLoop: localTools() && localStorage.getItem('aimparency-show-loop') === 'true' && localStorage.getItem('aimparency-show-watchdog') !== 'true',
    loopMaximized: false,
    loopHasHumanRequests: false,
    showLoopActionsOverlay: false,
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
    // The address bar names the open project: /spaces/<slug> for a graph of this
    // server, ?project=<path> for a directory of this machine.
    setProjectPath(path: string) {
      const cleanPath = normalizeProjectPath(path)
      this.projectPath = cleanPath
      const url = new URL(window.location.href)
      url.pathname = isGraphSlug(cleanPath) ? `/spaces/${cleanPath}` : '/'
      url.searchParams.delete('path')
      if (cleanPath && !isGraphSlug(cleanPath)) url.searchParams.set('project', cleanPath)
      else url.searchParams.delete('project')
      if (cleanPath) {
        localStorage.setItem('aimparency-project-path', cleanPath)
      } else {
        localStorage.removeItem('aimparency-project-path')
        url.searchParams.delete('repo')
      }
      window.history.replaceState({}, '', url)
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
