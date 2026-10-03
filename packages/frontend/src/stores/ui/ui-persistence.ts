import { useDataStore } from '../data'
import { useProjectStore } from '../project-store'
import { useGraphUIStore, type PersistedGraphViewState } from './graph-store'
import { captureSelectionAnchor, applySelectionAnchor, type SelectionAnchor } from './selection-anchor'
import { ensureIdeaUIState, type IdeaUIStateTree } from './idea-ui-state'
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
  floatingIdeaIndex: number
  lastSelectedSubPhaseIndexByPhase: Record<string, number>
  navigatingIdeas: boolean
  selectedIdeaIndexByPhaseId: Record<string, number>
  selectedIncomingIndexByIdeaId?: Record<string, number>
  expandedIdeaIds?: string[]
  floatingIdeaUIStates?: IdeaUIStateTree
  phaseIdeaUIStatesByPhaseId?: Record<string, IdeaUIStateTree>
  // Authoritative selection by identity; the index fields above only seed
  // remembered per-phase positions (and older saved states).
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
  const dataStore = useDataStore()
  const selectedIdeaIndexByPhaseId: Record<string, number> = {}

  for (const phase of Object.values(dataStore.phases)) {
    if (phase?.selectedIdeaIndex !== undefined) {
      selectedIdeaIndexByPhaseId[phase.id] = phase.selectedIdeaIndex
    }
  }

  return {
    activeColumn: ui.activeColumn,
    windowStart: ui.windowStart,
    windowSize: ui.windowSize,
    selectedEntryKeyByColumn: { ...ui.selectedEntryKeyByColumn },
    floatingIdeaIndex: ui.floatingIdeaIndex,
    lastSelectedSubPhaseIndexByPhase: { ...ui.lastSelectedSubPhaseIndexByPhase },
    navigatingIdeas: ui.navigatingIdeas,
    selectedIdeaIndexByPhaseId,
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
  const meta = dataStore.meta
  if (!meta?.phaseCursors || Object.keys(meta.phaseCursors).length === 0) return false

  ui.beginUIStateRestore()
  const restoreGeneration = ui.restoreGeneration
  try {
    const deepestLevel = await ui.restoreSelectionPath(
      meta.phaseCursors as Record<string, string>,
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

export async function restoreProjectUIState(ui: UIStore): Promise<boolean> {
  const restoreStartedAt = performance.now()
  perfLog('ui.restoreProjectUIState:start', { projectPath: useProjectStore().projectPath })
  const projectStore = useProjectStore()
  const dataStore = useDataStore()
  const graphStore = useGraphUIStore()

  if (!projectStore.projectPath) return false

  // The current phase lives in meta (set only via `c`), independent of browsing focus.
  ui.currentPhaseIdByLevel = { ...((dataStore.meta?.phaseCursors as Record<string, string>) ?? {}) }

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

  // This browser's own saved selection wins: reopen exactly where it left
  // off. The shared phase cursors only seed a browser without saved state.
  if (!parsed.listViewState) {
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
      ui.floatingIdeaIndex = listViewState.floatingIdeaIndex
      ui.lastSelectedSubPhaseIndexByPhase = { ...listViewState.lastSelectedSubPhaseIndexByPhase }
      ui.navigatingIdeas = listViewState.navigatingIdeas
      ui.scrollTopByColumn = {}

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

      for (const [phaseId, selectedIdeaIndex] of Object.entries(listViewState.selectedIdeaIndexByPhaseId)) {
        const phase = dataStore.phases[phaseId]
        if (phase) {
          phase.selectedIdeaIndex = selectedIdeaIndex
        }
      }

      if (listViewState.floatingIdeaUIStates) {
        ui.floatingIdeaUIStates = listViewState.floatingIdeaUIStates
      }
      if (listViewState.phaseIdeaUIStatesByPhaseId) {
        ui.phaseIdeaUIStatesByPhaseId = listViewState.phaseIdeaUIStatesByPhaseId
      }

      if (listViewState.expandedIdeaIds || listViewState.selectedIncomingIndexByIdeaId) {
        const expandedIdeaIds = new Set(listViewState.expandedIdeaIds ?? [])
        for (const idea of Object.values(dataStore.ideas)) {
          if (!idea) continue
          if (!expandedIdeaIds.has(idea.id) && listViewState.selectedIncomingIndexByIdeaId?.[idea.id] === undefined) continue
          const state = ensureIdeaUIState(ui.floatingIdeaUIStates, idea.id)
          state.expanded = expandedIdeaIds.has(idea.id)
          const selectedIncomingIndex = listViewState.selectedIncomingIndexByIdeaId?.[idea.id]
          if (selectedIncomingIndex !== undefined) {
            state.selectedIncomingIndex = selectedIncomingIndex
          }
        }
      }

      if (ui.navigatingIdeas && ui.activeColumn >= 0) {
        const activePhaseId = ui.selectedPhaseIdByColumn[ui.activeColumn]
        if (activePhaseId) {
          const phase = dataStore.phases[activePhaseId]
          if (phase && listViewState.selectedIdeaIndexByPhaseId[activePhaseId] !== undefined) {
            phase.selectedIdeaIndex = Math.min(
              listViewState.selectedIdeaIndexByPhaseId[activePhaseId]!,
              Math.max(0, phase.commitments.length - 1)
            )
          }
        }
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
