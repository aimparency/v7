import { defineStore } from 'pinia'
import { gitRepositoryLocation } from 'shared'
import { trpc } from '../trpc'
import { getRuntimeConfig } from '../utils/runtime-config'
import { perfLog } from '../utils/perf-log'
import { useDataStore, type ProjectLoadStage } from './data'
import { useHistoryStore } from './history'
import { useMapStore } from './map'
import { setRepoUrlParam, useProjectStore } from './project-store'
import { useUIStore } from './ui'

export type LoadStep = 'clone' | 'open' | 'read' | 'calculate' | 'restore' | 'view'

const STEP_LABELS: Record<LoadStep, string> = {
  clone: 'Cloning repository',
  open: 'Opening project',
  read: 'Loading phases and ideas',
  calculate: 'Calculating priorities',
  restore: 'Restoring your view',
  view: 'Building the view'
}

// Rough shares of a load's time, for the overall bar.
const STEP_WEIGHTS: Record<LoadStep, number> = { clone: 40, open: 10, read: 40, calculate: 10, restore: 5, view: 35 }

// The share of a whole load that is done. `stepFraction` is how far the current step is.
export function overallProgress(steps: LoadStep[], stepIndex: number, stepFraction: number) {
  const weightOf = (step: LoadStep) => STEP_WEIGHTS[step]
  const total = steps.reduce((sum, step) => sum + weightOf(step), 0)
  const finished = steps.slice(0, stepIndex).reduce((sum, step) => sum + weightOf(step), 0)
  return (finished + weightOf(steps[stepIndex]!) * Math.min(1, stepFraction)) / total
}

// A broken view must not lock the app behind the screen.
export const VIEW_READY_TIMEOUT_MS = 20_000

// Lets the browser paint between steps. The timer is for background tabs, which
// run no animation frames.
const nextPaint = () => new Promise<void>((resolve) => {
  const fallback = setTimeout(resolve, 50)
  requestAnimationFrame(() => {
    clearTimeout(fallback)
    setTimeout(resolve, 0)
  })
})

// Every open() gets a number; only the latest may change anything after an await.
let latestLoad = 0
let resolveViewReady: (() => void) | null = null

export const useProjectLoadStore = defineStore('project-load', {
  state: () => ({
    status: 'idle' as 'idle' | 'loading' | 'failed',
    target: '',
    error: '',
    // False from the click until the project's data and UI state are in place.
    viewsMayMount: true,
    steps: ['open', 'read', 'calculate', 'restore', 'view'] as LoadStep[],
    stepIndex: 0,
    stepLabel: '',
    // Null while the step has nothing to count: the detail bar shows it's alive instead.
    detail: null as { done: number, total: number } | null,
    detailLabel: ''
  }),

  getters: {
    isActive: (state) => state.status !== 'idle',
    isWaitingForView: (state) => state.status === 'loading' && state.steps[state.stepIndex] === 'view',
    detailFraction: (state) => state.detail && state.detail.total > 0 ? state.detail.done / state.detail.total : null,
    overallFraction(): number {
      return overallProgress(this.steps, this.stepIndex, this.detailFraction ?? 0)
    },
    targetName: (state) => state.target.replace(/\/+$/, '').split('/').slice(-2).join('/')
  },

  actions: {
    enterStep(step: LoadStep, label = STEP_LABELS[step]) {
      this.stepIndex = this.steps.indexOf(step)
      this.stepLabel = label
      this.detail = null
      this.detailLabel = ''
    },

    setDetail(done: number, total: number, label: string) {
      this.detail = { done, total }
      this.detailLabel = label
    },

    // From the mounted view; nothing to do when it mounts outside a load (a view switch).
    reportViewProgress(done: number, total: number, label: string) {
      if (this.isWaitingForView) this.setDetail(done, total, label)
    },

    viewIsReady() {
      resolveViewReady?.()
    },

    // Opens a project path or Git URL. Never rejects: failures show on the screen.
    async open(target: string) {
      const load = ++latestLoad
      const isCurrent = () => load === latestLoad
      resolveViewReady?.() // a load this one replaces stops waiting for its view
      const isGitUrl = !!gitRepositoryLocation(target)
      const projectStore = useProjectStore()
      const dataStore = useDataStore()
      const uiStore = useUIStore()

      this.status = 'loading'
      this.target = target
      this.error = ''
      this.viewsMayMount = false
      this.steps = [...(isGitUrl ? ['clone' as const] : []), 'open', 'read', 'calculate', 'restore', 'view']
      this.enterStep(this.steps[0]!)
      uiStore.beginUIStateRestore()

      let stopProgress = () => {}
      try {
        let projectPath = target
        if (isGitUrl) {
          // Someone else's project: the backend clones its .bowman and opens it read-only.
          projectPath = (await trpc.project.openGitUrl.mutate({ url: target })).projectPath
          if (!isCurrent()) return
        }

        this.resetOpenProject()
        projectStore.setProjectPath(projectPath)
        projectPath = projectStore.projectPath
        setRepoUrlParam(isGitUrl ? target : '') // keeps the address of a cloned project shareable

        this.enterStep('open')
        await nextPaint()
        if (!isCurrent()) return

        const progress = trpc.project.onLoadProgress.subscribe({ projectPath }, {
          onData: ({ done, total }) => {
            if (isCurrent() && this.steps[this.stepIndex] === 'read') this.setDetail(done, total, 'Reading ideas')
          },
          // The bars are a nicety: losing them is no reason to fail the load.
          onError: (error) => console.warn('Project load progress stopped', error)
        })
        stopProgress = () => progress.unsubscribe()

        let opened = 0
        const stageHandlers: Record<ProjectLoadStage, () => void | Promise<void>> = {
          opening: () => this.setDetail(++opened, 2, 'Reading project settings'),
          reading: () => { this.enterStep('read') },
          applying: async () => {
            this.enterStep('calculate')
            await nextPaint()
          }
        }
        const loaded = await dataStore.loadProject(projectPath, {
          isCurrent,
          onProgress: (stage) => stageHandlers[stage]()
        })
        stopProgress()
        if (!loaded || !isCurrent()) return

        this.enterStep('restore')
        await nextPaint()
        if (!isCurrent()) return
        await this.restoreView()
        if (!isCurrent()) return

        await this.showView()
        if (!isCurrent()) return

        projectStore.addProjectToHistory(projectPath)
        projectStore.clearProjectFailure(projectPath)
        this.status = 'idle'
        uiStore.endUIStateRestore()
      } catch (error) {
        stopProgress()
        if (!isCurrent()) return
        perfLog('data.loadProject:error', { target, error })
        console.error('Failed to open project:', error)
        this.error = error instanceof Error ? error.message : String(error)
        this.status = 'failed'
        projectStore.setConnectionStatus('no connection')
        if (projectStore.projectPath) projectStore.markProjectAsFailed(projectStore.projectPath)
        this.resetOpenProject()
      }
    },

    retry() {
      void this.open(this.target)
    },

    // Back to the project selection: from a failed load, or one taking too long.
    cancel() {
      if (getRuntimeConfig().hosted) return
      latestLoad++
      resolveViewReady?.()
      this.resetOpenProject()
      useProjectStore().setProjectPath('')
      useUIStore().endUIStateRestore()
      this.status = 'idle'
      this.viewsMayMount = true
    },

    resetOpenProject() {
      useDataStore().resetProjectData()
      useUIStore().resetViewState()
      useHistoryStore().reset()
      useProjectStore().setCurrentView('columns')
      useMapStore().resetView()
    },

    async restoreView() {
      const uiStore = useUIStore()
      const restored = await uiStore.restoreProjectUIState()
      if (!restored && !Object.keys(uiStore.selectedEntryKeyByColumn).length) {
        await uiStore.selectPhase(0, 0)
      }
      uiStore.ensureSelectionVisible()
    },

    // Mounts the restored view and waits until it says its DOM is ready.
    async showView() {
      const projectStore = useProjectStore()
      const contentHidden = projectStore.terminalFullscreen
        || (projectStore.showWatchdog && projectStore.watchdogMaximized)
        || (projectStore.showLoop && projectStore.loopMaximized)
      const view = projectStore.currentView
      this.enterStep('view', view === 'graph' ? 'Preparing the graph' : 'Laying out lists')

      // Nothing to wait for when the view has no ready signal or no size to lay out in.
      const ready = contentHidden || view === 'voice'
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            resolveViewReady = () => {
              resolveViewReady = null
              resolve()
            }
          })
      this.viewsMayMount = true

      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([ready, new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          console.warn(`The ${view} view did not report ready within ${VIEW_READY_TIMEOUT_MS} ms`)
          resolve()
        }, VIEW_READY_TIMEOUT_MS)
      })])
      clearTimeout(timeout)
    }
  }
})
