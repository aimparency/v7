import { useDataStore, type Idea, type Phase } from '../data'
import { ensureAimUIState, type IdeaUIState, type IdeaUIStateTree } from './idea-ui-state'

export type SelectionPath = {
  phase: Phase | undefined
  ideas: Idea[]
  ideaStates: IdeaUIState[]
}

export type TreeTraversalResult = {
  ideaId: string
  topLevelIndex: number
  parentAimId?: string
  indexInParent?: number
}

type DataStore = ReturnType<typeof useDataStore>

export function isAimInTree(ideaId: string, rootAim: Idea, dataStore: DataStore, visited: Set<string> = new Set()): boolean {
  if (rootAim.id === ideaId) {
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
    const child = dataStore.ideas[connection.ideaId]
    if (child && isAimInTree(ideaId, child, dataStore, nextVisited)) {
      return true
    }
  }

  return false
}

export function makeSelectedAimPath(idea: Idea, state: IdeaUIState, path: Idea[], statePath: IdeaUIState[], dataStore: DataStore): Idea {
  path.push(idea)
  statePath.push(state)

  if (state.expanded && state.selectedIncomingIndex !== undefined) {
    const connections = idea.supportingConnections || []
    if (state.selectedIncomingIndex < connections.length) {
      const selectedConnection = connections[state.selectedIncomingIndex]
      const childAim = selectedConnection ? dataStore.ideas[selectedConnection.ideaId] : undefined
      if (childAim) {
        const childState = ensureAimUIState(state.children, childAim.id)
        return makeSelectedAimPath(childAim, childState, path, statePath, dataStore)
      }
    }
  }

  return idea
}

export function getSelectionPathFromState(
  navigatingAims: boolean,
  activeColumn: number,
  floatingAimIndex: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  getFloatingAimUIStates: () => IdeaUIStateTree,
  getPhaseAimUIStates: (phaseId: string) => IdeaUIStateTree
): SelectionPath {
  const dataStore = useDataStore()
  if (!navigatingAims) {
    return { phase: undefined, ideas: [], ideaStates: [] }
  }

  if (activeColumn === -1) {
    const floatingAims = dataStore.floatingAims
    if (!floatingAims.length) {
      return { phase: undefined, ideas: [], ideaStates: [] }
    }

    const validIndex = Math.max(0, Math.min(floatingAimIndex, floatingAims.length - 1))
    const selectedAim = floatingAims[validIndex]
    if (!selectedAim) {
      return { phase: undefined, ideas: [], ideaStates: [] }
    }

    const ideaPath: Idea[] = []
    const statePath: IdeaUIState[] = []
    const selectedState = ensureAimUIState(getFloatingAimUIStates(), selectedAim.id)
    makeSelectedAimPath(selectedAim, selectedState, ideaPath, statePath, dataStore)
    return { phase: undefined, ideas: ideaPath, ideaStates: statePath }
  }

  const phaseId = getSelectedPhaseId(activeColumn)
  if (!phaseId) {
    return { phase: undefined, ideas: [], ideaStates: [] }
  }

  const phase = dataStore.phases[phaseId]
  const ideas = dataStore.getAimsForPhase(phaseId)
  const ideaPath: Idea[] = []
  const statePath: IdeaUIState[] = []

  if (phase?.selectedAimIndex !== undefined) {
    const selectedAim = ideas[phase.selectedAimIndex]
    if (selectedAim) {
      const selectedState = ensureAimUIState(getPhaseAimUIStates(phaseId), selectedAim.id)
      makeSelectedAimPath(selectedAim, selectedState, ideaPath, statePath, dataStore)
    }
  }

  return { phase, ideas: ideaPath, ideaStates: statePath }
}

// One row per rendered idea of a list: the top-level ideas and, recursively, the
// children of expanded ideas, in display order. `indexPath` is the top-level
// index followed by connection indices, the encoding of the selection chain
// (selectedAimIndex / floatingAimIndex, then selectedIncomingIndex per level).
export type IdeaRow = { ideaId: string; indexPath: number[] }

export function getVisibleAimRows(topLevelAims: Idea[], tree: IdeaUIStateTree, dataStore: DataStore): IdeaRow[] {
  const rows: IdeaRow[] = []
  const visit = (idea: Idea, state: IdeaUIState | undefined, indexPath: number[]) => {
    rows.push({ ideaId: idea.id, indexPath })
    if (!state?.expanded) return
    ;(idea.supportingConnections ?? []).forEach((connection, index) => {
      const child = dataStore.ideas[connection.ideaId]
      if (child) visit(child, state.children?.[child.id], [...indexPath, index])
    })
  }
  topLevelAims.forEach((idea, index) => visit(idea, tree[idea.id], [index]))
  return rows
}

export function setCurrentAimIndexInState(
  activeColumn: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  setFloatingAimIndex: (index: number) => void,
  ideaIndex: number,
  dataStore: DataStore
): void {
  if (activeColumn === -1) {
    setFloatingAimIndex(ideaIndex)
    return
  }

  const phaseId = getSelectedPhaseId(activeColumn)
  if (!phaseId) {
    return
  }

  const phase = dataStore.phases[phaseId]
  if (phase) {
    phase.selectedAimIndex = ideaIndex
  }
}

export function findPathToAim(targetId: string, topLevelAims: Idea[], dataStore: DataStore): TreeTraversalResult[] | null {
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
  currentAim: Idea,
  dataStore: DataStore,
  topLevelIndex: number,
  indexInParent: number | undefined,
  visited: Set<string> = new Set()
): TreeTraversalResult[] | null {
  if (currentAim.id === targetId) {
    return [{ ideaId: currentAim.id, topLevelIndex, indexInParent }]
  }

  if (visited.has(currentAim.id)) {
    return null
  }
  const nextVisited = new Set(visited)
  nextVisited.add(currentAim.id)

  if (currentAim.supportingConnections?.length) {
    for (let i = 0; i < currentAim.supportingConnections.length; i++) {
      const childConnection = currentAim.supportingConnections[i]
      const childAim = childConnection ? dataStore.ideas[childConnection.ideaId] : undefined
      if (!childAim) {
        continue
      }

      const childPath = findPathInTree(targetId, childAim, dataStore, topLevelIndex, i, nextVisited)
      if (childPath) {
        return [{ ideaId: currentAim.id, topLevelIndex, indexInParent }, ...childPath]
      }
    }
  }

  return null
}
