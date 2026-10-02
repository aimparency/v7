import { useDataStore } from '../data'
import { ensureIdeaUIState } from './idea-ui-state'
import { getSelectionPathFromState } from './navigation-helpers'

// The list-view selection by identity rather than by index: which entry each
// column has selected, which column is focused, and the chain of idea ids down
// to the selected idea. Indices drift whenever entries are reordered, created or
// deleted (undo, other clients, reload); ids don't.
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
    uiStore.floatingIdeaIndex,
    (columnIndex) => uiStore.getSelectedPhaseId(columnIndex),
    () => uiStore.getFloatingIdeaUIStates(),
    (phaseId) => uiStore.getPhaseIdeaUIStates(phaseId)
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
  const dataStore = useDataStore()
  const column = uiStore.activeColumn
  const phaseId = column >= 0 ? uiStore.selectedPhaseIdByColumn[column] : undefined
  if (column >= 0 && !phaseId) return false

  const topLevelIdeas = phaseId ? dataStore.getIdeasForPhase(phaseId) : dataStore.floatingIdeas
  const topIndex = topLevelIdeas.findIndex((idea) => idea?.id === ideaPath[0])
  let idea = topLevelIdeas[topIndex]
  if (!idea) return false
  uiStore.setCurrentIdeaIndex(topIndex, dataStore)

  let state = ensureIdeaUIState(phaseId ? uiStore.getPhaseIdeaUIStates(phaseId) : uiStore.floatingIdeaUIStates, idea.id)
  for (const childId of ideaPath.slice(1)) {
    const childIndex = (idea.supportingConnections ?? []).findIndex((connection) => connection.ideaId === childId)
    const child = dataStore.ideas[childId]
    if (childIndex < 0 || !child) break
    state.expanded = true
    state.selectedIncomingIndex = childIndex
    idea = child
    state = ensureIdeaUIState(state.children, child.id)
  }
  state.selectedIncomingIndex = undefined
  return true
}

// Runs `applyChange` (another client's pushed change) without letting the
// index-based idea selection slide onto a different idea.
export function keepIdeaSelection(uiStore: any, applyChange: () => void) {
  if (!uiStore.navigatingIdeas || uiStore.isRestoringUIState) {
    applyChange()
    return
  }
  const ideaPath = captureSelectionAnchor(uiStore).ideaPath
  applyChange()
  if (ideaPath.length > 0) applyIdeaPath(uiStore, ideaPath)
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
    const phase = phaseId ? dataStore.phases[phaseId] : undefined
    if (phase && phase.selectedIdeaIndex !== undefined) {
      phase.selectedIdeaIndex = Math.max(0, Math.min(phase.selectedIdeaIndex, ideas.length - 1))
    }
    uiStore.navigatingIdeas = ideas.length > 0
  } else {
    uiStore.navigatingIdeas = anchor.navigatingIdeas
  }

  uiStore.ensureSelectionVisible()
}
