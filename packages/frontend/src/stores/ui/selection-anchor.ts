import { useDataStore } from '../data'
import { ensureIdeaUIState } from './idea-ui-state'
import { getSelectionPathFromState } from './navigation-helpers'

// A snapshot of the list-view selection for undo/redo and reload: which entry
// each column has selected, which column is focused, and the chain of idea ids
// down to the selected idea.
export type SelectionAnchor = {
  activeColumn: number
  maxColumn: number
  entryKeyByColumn: Record<number, string>
  navigatingIdeas: boolean
  // Top-level idea (phase commitment or floating idea) → … → selected idea. Also
  // kept while not navigating ideas: it's the idea the phase remembers.
  ideaPath: string[]
}

const PHASE_KEY_PREFIX = 'phase:'

export function captureSelectionAnchor(uiStore: any): SelectionAnchor {
  const path = getSelectionPathFromState(
    true,
    uiStore.activeColumn,
    (columnIndex: number) => uiStore.getSelectedPhaseId(columnIndex),
    (phaseId: string | undefined) => uiStore.getSelectedTopIdeaId(phaseId),
    () => uiStore.getFloatingIdeaUIStates(),
    (phaseId: string) => uiStore.getPhaseIdeaUIStates(phaseId)
  )
  return {
    activeColumn: uiStore.activeColumn,
    maxColumn: uiStore.maxColumn,
    entryKeyByColumn: { ...uiStore.selectedEntryKeyByColumn },
    navigatingIdeas: uiStore.navigatingIdeas,
    ideaPath: path.ideas.map((idea) => idea.id)
  }
}

// Selects the idea chain by id below the focused column's phase (or among the
// floating ideas), expanding the ancestors. Stops at the deepest idea that still
// exists at that position. Returns false when the top-level idea is gone.
function applyIdeaPath(uiStore: any, ideaPath: string[]): boolean {
  const scope = uiStore.getIdeaListScope()
  if (!scope?.ideas.some((idea: { id: string }) => idea.id === ideaPath[0])) return false

  const existing = ideaPath.slice(0, 1)
  let state = ensureIdeaUIState(scope.tree, ideaPath[0]!)
  for (const childId of ideaPath.slice(1)) {
    if (!childIdsOf(existing[existing.length - 1]!).includes(childId)) break
    state.expanded = true
    existing.push(childId)
    state = ensureIdeaUIState(state.children, childId)
  }
  uiStore.selectIdeaPath(scope, existing)
  return true
}

function childIdsOf(ideaId: string): string[] {
  const dataStore = useDataStore()
  return (dataStore.ideas[ideaId]?.supportingConnections ?? [])
    .map((connection) => connection.ideaId)
    .filter((childId) => dataStore.ideas[childId])
}

// The ids of the list each idea of `ideaPath` is shown in: the top-level list,
// then the children of the idea above it.
function listsAlong(topLevelIds: string[], ideaPath: string[]): string[][] {
  return ideaPath.map((_, depth) => depth === 0 ? topLevelIds : childIdsOf(ideaPath[depth - 1]!))
}

// Runs `applyChange` (a pushed change). The selection is by id, so reorders and
// inserts don't move it; when the change takes an idea of the selection path out
// of its list, the idea now at its position is selected instead (its successor,
// or the new last entry), as after dd.
export function keepIdeaSelection(uiStore: any, applyChange: () => void) {
  const scope = uiStore.navigatingIdeas && !uiStore.isRestoringUIState ? uiStore.getIdeaListScope() : undefined
  const before: string[] = scope ? uiStore.getSelectionPath().ideas.map((idea: { id: string }) => idea.id) : []
  const topLevelIds = (ideas: { id: string }[]) => ideas.map((idea) => idea.id)
  const positions = listsAlong(scope ? topLevelIds(scope.ideas) : [], before).map((ids, depth) => ids.indexOf(before[depth]!))
  applyChange()
  if (before.length === 0) return

  const after = uiStore.getIdeaListScope(scope.phaseId)
  if (!after) return
  const lists = listsAlong(topLevelIds(after.ideas), before)
  const idPath: string[] = []
  for (const [depth, id] of before.entries()) {
    const ids = lists[depth]!
    if (ids.includes(id)) {
      idPath.push(id)
      continue
    }
    const replacement = ids[Math.min(positions[depth]!, ids.length - 1)]
    if (replacement) idPath.push(replacement)
    break
  }
  if (idPath.length > 0 && idPath.join('/') !== before.join('/')) uiStore.selectIdeaPath(after, idPath)
}

export async function applySelectionAnchor(uiStore: any, anchor: SelectionAnchor) {
  const dataStore = useDataStore()

  const phaseIdByLevel: Record<number, string> = {}
  for (const [level, key] of Object.entries(anchor.entryKeyByColumn)) {
    if (key.startsWith(PHASE_KEY_PREFIX)) phaseIdByLevel[Number(level)] = key.slice(PHASE_KEY_PREFIX.length)
  }
  const deepestLevel = await uiStore.restoreSelectionPath(
    phaseIdByLevel,
    () => true,
    Math.max(0, anchor.maxColumn, anchor.activeColumn)
  ) ?? 0
  uiStore.maxColumn = deepestLevel
  uiStore.activeColumn = Math.min(anchor.activeColumn, deepestLevel)

  const ideaFound = anchor.ideaPath.length > 0 && applyIdeaPath(uiStore, anchor.ideaPath)
  if (anchor.navigatingIdeas && !ideaFound) {
    // The selected idea is gone: stay in idea mode only if there is an idea to select.
    const phaseId = uiStore.activeColumn >= 0 ? uiStore.selectedPhaseIdByColumn[uiStore.activeColumn] : undefined
    const ideas = phaseId ? dataStore.getIdeasForPhase(phaseId) : dataStore.floatingIdeas
    if (phaseId && ideas.length > 0 && !ideas.some((idea) => idea.id === uiStore.selectedIdeaIdByPhaseId[phaseId])) {
      uiStore.selectTopIdea(phaseId, ideas[0]!.id)
    }
    uiStore.navigatingIdeas = ideas.length > 0
  } else {
    uiStore.navigatingIdeas = anchor.navigatingIdeas
  }

  uiStore.ensureSelectionVisible()
}
