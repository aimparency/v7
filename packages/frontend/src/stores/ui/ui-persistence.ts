import { currentPhaseCursors } from 'shared'
import { useDataStore } from '../data'
import { useProjectStore } from '../project-store'
import { useGraphUIStore, type PersistedGraphViewState } from './graph-store'
import { captureSelectionAnchor, applySelectionAnchor, type SelectionAnchor } from './selection-anchor'
import type { IdeaUIStateTree } from './idea-ui-state'
import { perfLog } from '../../utils/perf-log'
import type { useUIStore } from './list-store'

type UIStore = ReturnType<typeof useUIStore>

// Per-browser memory of where the user was in a project (view, columns,
// selection, graph camera), kept in localStorage. The shared "current phase"
// lives in meta.phaseCursors instead and only seeds a browser without saved state.

export const PHASE_KEY_PREFIX = 'phase:'

export type PersistedListViewState = {
  activeColumn: number
  windowStart: number
  windowSize: number
  selectedEntryKeyByColumn?: Record<number, string>
  // Legacy snapshots stored the selection as index + phase id.
  selectedPhaseIdByColumn?: Record<number, string>
  lastSelectedSubPhaseIndexByPhase: Record<string, number>
  navigatingIdeas: boolean
  // The idea each phase (and the floating list) remembers; saved states from
  // before kept indices instead and restore without them.
  selectedIdeaIdByPhaseId?: Record<string, string>
  floatingIdeaId?: string | null
  floatingIdeaUIStates?: IdeaUIStateTree
  phaseIdeaUIStatesByPhaseId?: Record<string, IdeaUIStateTree>
  // The focused selection, applied last.
  selection?: SelectionAnchor
}

type PersistedUIState = {
  currentView?: 'columns' | 'graph' | 'voice'
  listViewState?: PersistedListViewState
  graphViewState?: PersistedGraphViewState
}

export function persistedUIStateKey(projectPath: string) {
  return `aimparency-ui-state:${projectPath}`
}

export function listViewStateSnapshot(ui: UIStore): PersistedListViewState {
  return {
    activeColumn: ui.activeColumn,
    windowStart: ui.windowStart,
    windowSize: ui.windowSize,
    selectedEntryKeyByColumn: { ...ui.selectedEntryKeyByColumn },
    lastSelectedSubPhaseIndexByPhase: { ...ui.lastSelectedSubPhaseIndexByPhase },
    navigatingIdeas: ui.navigatingIdeas,
    // Only phases that still exist: deleted phases leave nothing behind.
    selectedIdeaIdByPhaseId: Object.fromEntries(Object.entries(ui.selectedIdeaIdByPhaseId).filter(([phaseId]) => useDataStore().phases[phaseId])),
    floatingIdeaId: ui.floatingIdeaId,
    floatingIdeaUIStates: ui.floatingIdeaUIStates,
    phaseIdeaUIStatesByPhaseId: ui.phaseIdeaUIStatesByPhaseId,
    selection: captureSelectionAnchor(ui)
  }
}

export async function persistProjectUIState(ui: UIStore): Promise<void> {
  const projectStore = useProjectStore()
  if (!projectStore.projectPath) return

  const graphStore = useGraphUIStore()
  const state: PersistedUIState = {
    currentView: projectStore.currentView,
    listViewState: listViewStateSnapshot(ui),
    graphViewState: graphStore.getPersistedGraphViewState()
  }

  localStorage.setItem(persistedUIStateKey(projectStore.projectPath), JSON.stringify(state))
}

export async function restoreCursorFromMeta(ui: UIStore): Promise<boolean> {
  const dataStore = useDataStore()
  const cursors = currentPhaseCursors(dataStore.meta)
  if (Object.keys(cursors).length === 0) return false

  ui.beginUIStateRestore()
  const restoreGeneration = ui.restoreGeneration
  try {
    const deepestLevel = await ui.restoreSelectionPath(
      cursors,
      () => ui.isRestoringUIState && ui.restoreGeneration === restoreGeneration
    )
    if (deepestLevel === undefined) return true

    // Startup follows the complete authoritative cursor chain. Focus the
    // deepest populated phase level rather than restoring a stale browser
    // column or exposing a trailing empty child column.
    ui.activeColumn = deepestLevel
    ui.maxColumn = deepestLevel
    ui.ensureSelectionVisible()
    return true
  } finally {
    if (ui.restoreGeneration === restoreGeneration && ui.isRestoringUIState) {
      ui.endUIStateRestore()
    }
  }
}

// The project this tab has open, kept across reloads of the tab (sessionStorage)
// but not into a new tab: tells opening a project apart from reloading it.
const OPEN_PROJECT_KEY = 'aimparency:open-project'

// Marks `projectPath` as open in this tab; true when it was not already, i.e.
// the project is being opened rather than reloaded.
export function markProjectOpenInTab(projectPath: string): boolean {
  try {
    const opening = sessionStorage.getItem(OPEN_PROJECT_KEY) !== projectPath
    sessionStorage.setItem(OPEN_PROJECT_KEY, projectPath)
    return opening
  } catch {
    return true
  }
}

export function forgetProjectOpenInTab(): void {
  try { sessionStorage.removeItem(OPEN_PROJECT_KEY) } catch { /* storage unavailable */ }
}

// Opening a project starts at its current phase (the cursor chain in meta);
// a reload of the same tab reopens exactly where this browser left off.
export async function restoreProjectUIState(ui: UIStore, { followCurrentPhase = false } = {}): Promise<boolean> {
  const restoreStartedAt = performance.now()
  perfLog('ui.restoreProjectUIState:start', { projectPath: useProjectStore().projectPath })
  const projectStore = useProjectStore()
  const dataStore = useDataStore()
  const graphStore = useGraphUIStore()

  if (!projectStore.projectPath) return false

  // The current phase lives in meta (set only via `c`), independent of browsing focus.
  ui.currentPhaseIdByLevel = currentPhaseCursors(dataStore.meta)

  const raw = localStorage.getItem(persistedUIStateKey(projectStore.projectPath))
  if (!raw) {
    return await restoreCursorFromMeta(ui)
  }

  let parsed: PersistedUIState | null = null
  try {
    parsed = JSON.parse(raw) as PersistedUIState
  } catch {
    return await restoreCursorFromMeta(ui)
  }

  // Opening follows the current phase, keeping this browser's layout. On a
  // reload, or without a current phase, the browser's own selection wins.
  const followCursors = followCurrentPhase && Object.keys(ui.currentPhaseIdByLevel).length > 0
  if (!parsed.listViewState || followCursors) {
    if (parsed.listViewState) {
      ui.windowSize = parsed.listViewState.windowSize
      ui.phaseIdeaUIStatesByPhaseId = parsed.listViewState.phaseIdeaUIStatesByPhaseId ?? ui.phaseIdeaUIStatesByPhaseId
    }
    if (parsed.currentView) projectStore.setCurrentView(parsed.currentView)
    graphStore.applyPersistedGraphViewState(parsed.graphViewState)
    return await restoreCursorFromMeta(ui)
  }

  ui.beginUIStateRestore()
  const restoreGeneration = ui.restoreGeneration
  try {
    if (parsed.currentView) {
      projectStore.setCurrentView(parsed.currentView)
    }

    const listViewState = parsed.listViewState
    if (listViewState) {
      ui.windowSize = listViewState.windowSize
      ui.windowStart = listViewState.windowStart
      ui.activeColumn = listViewState.activeColumn
      ui.floatingIdeaId = listViewState.floatingIdeaId ?? null
      ui.lastSelectedSubPhaseIndexByPhase = { ...listViewState.lastSelectedSubPhaseIndexByPhase }
      ui.navigatingIdeas = listViewState.navigatingIdeas

      const shouldContinue = () => ui.isRestoringUIState && ui.restoreGeneration === restoreGeneration
      const restoreVisibleMax = Math.max(ui.activeColumn, ui.getVisibleMaxColumn())
      const phaseIdByLevel: Record<number, string> = {}
      const savedKeys = listViewState.selectedEntryKeyByColumn
        ?? Object.fromEntries(Object.entries(listViewState.selectedPhaseIdByColumn ?? {}).map(([level, id]) => [level, `${PHASE_KEY_PREFIX}${id}`]))
      for (const [level, key] of Object.entries(savedKeys)) {
        if (Number(level) <= restoreVisibleMax && key.startsWith(PHASE_KEY_PREFIX)) {
          phaseIdByLevel[Number(level)] = key.slice(PHASE_KEY_PREFIX.length)
        }
      }

      ui.maxColumn = ui.windowStart < 0 ? -1 : 0
      if (restoreVisibleMax >= 0) {
        const deepestLevel = await ui.restoreSelectionPath(phaseIdByLevel, shouldContinue, restoreVisibleMax)
        if (deepestLevel === undefined) return true
        ui.maxColumn = Math.max(ui.maxColumn, deepestLevel)
      }
      if (ui.activeColumn > ui.maxColumn) {
        ui.activeColumn = ui.maxColumn
      }

      ui.selectedIdeaIdByPhaseId = { ...listViewState.selectedIdeaIdByPhaseId }
      if (listViewState.floatingIdeaUIStates) {
        ui.floatingIdeaUIStates = listViewState.floatingIdeaUIStates
      }
      if (listViewState.phaseIdeaUIStatesByPhaseId) {
        ui.phaseIdeaUIStatesByPhaseId = listViewState.phaseIdeaUIStatesByPhaseId
      }

      if (listViewState.selection) {
        await applySelectionAnchor(ui, listViewState.selection)
      }

      ui.ensureSelectionVisible()
    }

    graphStore.applyPersistedGraphViewState(parsed.graphViewState)
    perfLog('ui.restoreProjectUIState:done', {
      projectPath: projectStore.projectPath,
      durationMs: Math.round((performance.now() - restoreStartedAt) * 10) / 10,
      activeColumn: ui.activeColumn,
      windowStart: ui.windowStart,
      windowSize: ui.windowSize,
      maxColumn: ui.maxColumn
    })
    return true
  } finally {
    if (ui.restoreGeneration === restoreGeneration && ui.isRestoringUIState) {
      ui.endUIStateRestore()
    }
  }
}
