import { useDataStore, type Aim, type Phase } from '../data'
import { ensureAimUIState, type AimUIState, type AimUIStateTree } from './aim-ui-state'

export type SelectionPath = {
  phase: Phase | undefined
  aims: Aim[]
  aimStates: AimUIState[]
}

export type TreeTraversalResult = {
  aimId: string
  topLevelIndex: number
  parentAimId?: string
  indexInParent?: number
}

type DataStore = ReturnType<typeof useDataStore>

export function isAimInTree(aimId: string, rootAim: Aim, dataStore: DataStore, visited: Set<string> = new Set()): boolean {
  if (rootAim.id === aimId) {
    return true
  }

  if (visited.has(rootAim.id)) {
    return false
  }

  if (!rootAim.supportingConnections?.length) {
    return false
  }

  const nextVisited = new Set(visited)
  nextVisited.add(rootAim.id)

  for (const connection of rootAim.supportingConnections) {
    const child = dataStore.aims[connection.aimId]
    if (child && isAimInTree(aimId, child, dataStore, nextVisited)) {
      return true
    }
  }

  return false
}

export function makeSelectedAimPath(aim: Aim, state: AimUIState, path: Aim[], statePath: AimUIState[], dataStore: DataStore): Aim {
  path.push(aim)
  statePath.push(state)

  if (state.expanded && state.selectedIncomingIndex !== undefined) {
    const connections = aim.supportingConnections || []
    if (state.selectedIncomingIndex < connections.length) {
      const selectedConnection = connections[state.selectedIncomingIndex]
      const childAim = selectedConnection ? dataStore.aims[selectedConnection.aimId] : undefined
      if (childAim) {
        const childState = ensureAimUIState(state.children, childAim.id)
        return makeSelectedAimPath(childAim, childState, path, statePath, dataStore)
      }
    }
  }

  return aim
}

export function getSelectionPathFromState(
  navigatingAims: boolean,
  activeColumn: number,
  floatingAimIndex: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  getFloatingAimUIStates: () => AimUIStateTree,
  getPhaseAimUIStates: (phaseId: string) => AimUIStateTree
): SelectionPath {
  const dataStore = useDataStore()
  if (!navigatingAims) {
    return { phase: undefined, aims: [], aimStates: [] }
  }

  if (activeColumn === -1) {
    const floatingAims = dataStore.floatingAims
    if (!floatingAims.length) {
      return { phase: undefined, aims: [], aimStates: [] }
    }

    const validIndex = Math.max(0, Math.min(floatingAimIndex, floatingAims.length - 1))
    const selectedAim = floatingAims[validIndex]
    if (!selectedAim) {
      return { phase: undefined, aims: [], aimStates: [] }
    }

    const aimPath: Aim[] = []
    const statePath: AimUIState[] = []
    const selectedState = ensureAimUIState(getFloatingAimUIStates(), selectedAim.id)
    makeSelectedAimPath(selectedAim, selectedState, aimPath, statePath, dataStore)
    return { phase: undefined, aims: aimPath, aimStates: statePath }
  }

  const phaseId = getSelectedPhaseId(activeColumn)
  if (!phaseId) {
    return { phase: undefined, aims: [], aimStates: [] }
  }

  const phase = dataStore.phases[phaseId]
  const aims = dataStore.getAimsForPhase(phaseId)
  const aimPath: Aim[] = []
  const statePath: AimUIState[] = []

  if (phase?.selectedAimIndex !== undefined) {
    const selectedAim = aims[phase.selectedAimIndex]
    if (selectedAim) {
      const selectedState = ensureAimUIState(getPhaseAimUIStates(phaseId), selectedAim.id)
      makeSelectedAimPath(selectedAim, selectedState, aimPath, statePath, dataStore)
    }
  }

  return { phase, aims: aimPath, aimStates: statePath }
}

export function setCurrentAimIndexInState(
  activeColumn: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  setFloatingAimIndex: (index: number) => void,
  aimIndex: number,
  dataStore: DataStore
): void {
  if (activeColumn === -1) {
    setFloatingAimIndex(aimIndex)
    return
  }

  const phaseId = getSelectedPhaseId(activeColumn)
  if (!phaseId) {
    return
  }

  const phase = dataStore.phases[phaseId]
  if (phase) {
    phase.selectedAimIndex = aimIndex
  }
}

export function findPathToAim(targetId: string, topLevelAims: Aim[], dataStore: DataStore): TreeTraversalResult[] | null {
  for (let i = 0; i < topLevelAims.length; i++) {
    const root = topLevelAims[i]
    if (!root) {
      continue
    }

    const path = findPathInTree(targetId, root, dataStore, i, undefined)
    if (path) {
      return path
    }
  }

  return null
}

export function findPathInTree(
  targetId: string,
  currentAim: Aim,
  dataStore: DataStore,
  topLevelIndex: number,
  indexInParent: number | undefined,
  visited: Set<string> = new Set()
): TreeTraversalResult[] | null {
  if (currentAim.id === targetId) {
    return [{ aimId: currentAim.id, topLevelIndex, indexInParent }]
  }

  if (visited.has(currentAim.id)) {
    return null
  }
  const nextVisited = new Set(visited)
  nextVisited.add(currentAim.id)

  if (currentAim.supportingConnections?.length) {
    for (let i = 0; i < currentAim.supportingConnections.length; i++) {
      const childConnection = currentAim.supportingConnections[i]
      const childAim = childConnection ? dataStore.aims[childConnection.aimId] : undefined
      if (!childAim) {
        continue
      }

      const childPath = findPathInTree(targetId, childAim, dataStore, topLevelIndex, i, nextVisited)
      if (childPath) {
        return [{ aimId: currentAim.id, topLevelIndex, indexInParent }, ...childPath]
      }
    }
  }

  return null
}
