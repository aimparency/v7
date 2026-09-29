import { useDataStore } from '../data'
import { ensureAimUIState } from './aim-ui-state'
import { getSelectionPathFromState } from './navigation-helpers'

// The list-view selection by identity rather than by index: which entry each
// column has selected, which column is focused, and the chain of aim ids down
// to the selected aim. Indices drift whenever entries are reordered, created or
// deleted (undo, other clients, reload); ids don't.
export type SelectionAnchor = {
  activeColumn: number
  maxColumn: number
  entryKeyByColumn: Record<number, string>
  navigatingAims: boolean
  // Top-level aim (phase commitment or floating aim) → … → selected aim. Also
  // kept while not navigating aims: it's the aim the phase remembers.
  aimPath: string[]
}

const PHASE_KEY_PREFIX = 'phase:'

export function captureSelectionAnchor(uiStore: any): SelectionAnchor {
  const path = getSelectionPathFromState(
    true,
    uiStore.activeColumn,
    uiStore.floatingAimIndex,
    (columnIndex) => uiStore.getSelectedPhaseId(columnIndex),
    () => uiStore.getFloatingAimUIStates(),
    (phaseId) => uiStore.getPhaseAimUIStates(phaseId)
  )
  return {
    activeColumn: uiStore.activeColumn,
    maxColumn: uiStore.maxColumn,
    entryKeyByColumn: { ...uiStore.selectedEntryKeyByColumn },
    navigatingAims: uiStore.navigatingAims,
    aimPath: path.aims.map((aim) => aim.id)
  }
}

// Selects the aim chain by id below the focused column's phase (or among the
// floating aims), expanding the ancestors. Stops at the deepest aim that still
// exists at that position. Returns false when the top-level aim is gone.
function applyAimPath(uiStore: any, aimPath: string[]): boolean {
  const dataStore = useDataStore()
  const column = uiStore.activeColumn
  const phaseId = column >= 0 ? uiStore.selectedPhaseIdByColumn[column] : undefined
  if (column >= 0 && !phaseId) return false

  const topLevelAims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
  const topIndex = topLevelAims.findIndex((aim) => aim?.id === aimPath[0])
  let aim = topLevelAims[topIndex]
  if (!aim) return false
  uiStore.setCurrentAimIndex(topIndex, dataStore)

  let state = ensureAimUIState(phaseId ? uiStore.getPhaseAimUIStates(phaseId) : uiStore.floatingAimUIStates, aim.id)
  for (const childId of aimPath.slice(1)) {
    const childIndex = (aim.supportingConnections ?? []).findIndex((connection) => connection.aimId === childId)
    const child = dataStore.aims[childId]
    if (childIndex < 0 || !child) break
    state.expanded = true
    state.selectedIncomingIndex = childIndex
    aim = child
    state = ensureAimUIState(state.children, child.id)
  }
  state.selectedIncomingIndex = undefined
  return true
}

// Runs `applyChange` (another client's pushed change) without letting the
// index-based aim selection slide onto a different aim.
export function keepAimSelection(uiStore: any, applyChange: () => void) {
  if (!uiStore.navigatingAims || uiStore.isRestoringUIState) {
    applyChange()
    return
  }
  const aimPath = captureSelectionAnchor(uiStore).aimPath
  applyChange()
  if (aimPath.length > 0) applyAimPath(uiStore, aimPath)
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

  const aimFound = anchor.aimPath.length > 0 && applyAimPath(uiStore, anchor.aimPath)
  if (anchor.navigatingAims && !aimFound) {
    // The selected aim is gone: stay in aim mode only if there is an aim to select.
    const phaseId = uiStore.activeColumn >= 0 ? uiStore.selectedPhaseIdByColumn[uiStore.activeColumn] : undefined
    const aims = phaseId ? dataStore.getAimsForPhase(phaseId) : dataStore.floatingAims
    const phase = phaseId ? dataStore.phases[phaseId] : undefined
    if (phase && phase.selectedAimIndex !== undefined) {
      phase.selectedAimIndex = Math.max(0, Math.min(phase.selectedAimIndex, aims.length - 1))
    }
    uiStore.navigatingAims = aims.length > 0
  } else {
    uiStore.navigatingAims = anchor.navigatingAims
  }

  uiStore.ensureSelectionVisible()
}
