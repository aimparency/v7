import { useDataStore, type Idea, type Phase } from '../data'
import { ensureIdeaUIState, type IdeaUIState, type IdeaUIStateTree } from './idea-ui-state'

export type SelectionPath = {
  phase: Phase | undefined
  ideas: Idea[]
  ideaStates: IdeaUIState[]
}

export type TreeTraversalResult = {
  ideaId: string
  topLevelIndex: number
  parentIdeaId?: string
  indexInParent?: number
}

type DataStore = ReturnType<typeof useDataStore>

export function isIdeaInTree(ideaId: string, rootIdea: Idea, dataStore: DataStore, visited: Set<string> = new Set()): boolean {
  if (rootIdea.id === ideaId) {
    return true
  }

  if (visited.has(rootIdea.id)) {
    return false
  }

  if (!rootIdea.supportingConnections?.length) {
    return false
  }

  const nextVisited = new Set(visited)
  nextVisited.add(rootIdea.id)

  for (const connection of rootIdea.supportingConnections) {
    const child = dataStore.ideas[connection.ideaId]
    if (child && isIdeaInTree(ideaId, child, dataStore, nextVisited)) {
      return true
    }
  }

  return false
}

export function makeSelectedIdeaPath(idea: Idea, state: IdeaUIState, path: Idea[], statePath: IdeaUIState[], dataStore: DataStore): Idea {
  path.push(idea)
  statePath.push(state)

  if (state.expanded && state.selectedIncomingIndex !== undefined) {
    const connections = idea.supportingConnections || []
    if (state.selectedIncomingIndex < connections.length) {
      const selectedConnection = connections[state.selectedIncomingIndex]
      const childIdea = selectedConnection ? dataStore.ideas[selectedConnection.ideaId] : undefined
      if (childIdea) {
        const childState = ensureIdeaUIState(state.children, childIdea.id)
        return makeSelectedIdeaPath(childIdea, childState, path, statePath, dataStore)
      }
    }
  }

  return idea
}

export function getSelectionPathFromState(
  navigatingIdeas: boolean,
  activeColumn: number,
  floatingIdeaIndex: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  getFloatingIdeaUIStates: () => IdeaUIStateTree,
  getPhaseIdeaUIStates: (phaseId: string) => IdeaUIStateTree
): SelectionPath {
  const dataStore = useDataStore()
  if (!navigatingIdeas) {
    return { phase: undefined, ideas: [], ideaStates: [] }
  }

  if (activeColumn === -1) {
    const floatingIdeas = dataStore.floatingIdeas
    if (!floatingIdeas.length) {
      return { phase: undefined, ideas: [], ideaStates: [] }
    }

    const validIndex = Math.max(0, Math.min(floatingIdeaIndex, floatingIdeas.length - 1))
    const selectedIdea = floatingIdeas[validIndex]
    if (!selectedIdea) {
      return { phase: undefined, ideas: [], ideaStates: [] }
    }

    const ideaPath: Idea[] = []
    const statePath: IdeaUIState[] = []
    const selectedState = ensureIdeaUIState(getFloatingIdeaUIStates(), selectedIdea.id)
    makeSelectedIdeaPath(selectedIdea, selectedState, ideaPath, statePath, dataStore)
    return { phase: undefined, ideas: ideaPath, ideaStates: statePath }
  }

  const phaseId = getSelectedPhaseId(activeColumn)
  if (!phaseId) {
    return { phase: undefined, ideas: [], ideaStates: [] }
  }

  const phase = dataStore.phases[phaseId]
  const ideas = dataStore.getIdeasForPhase(phaseId)
  const ideaPath: Idea[] = []
  const statePath: IdeaUIState[] = []

  if (phase?.selectedIdeaIndex !== undefined) {
    const selectedIdea = ideas[phase.selectedIdeaIndex]
    if (selectedIdea) {
      const selectedState = ensureIdeaUIState(getPhaseIdeaUIStates(phaseId), selectedIdea.id)
      makeSelectedIdeaPath(selectedIdea, selectedState, ideaPath, statePath, dataStore)
    }
  }

  return { phase, ideas: ideaPath, ideaStates: statePath }
}

// One row per rendered idea of a list: the top-level ideas and, recursively, the
// children of expanded ideas, in display order. `indexPath` is the top-level
// index followed by connection indices, the encoding of the selection chain
// (selectedIdeaIndex / floatingIdeaIndex, then selectedIncomingIndex per level).
export type IdeaRow = { ideaId: string; indexPath: number[] }

export function getVisibleIdeaRows(topLevelIdeas: Idea[], tree: IdeaUIStateTree, dataStore: DataStore): IdeaRow[] {
  const rows: IdeaRow[] = []
  const visit = (idea: Idea, state: IdeaUIState | undefined, indexPath: number[]) => {
    rows.push({ ideaId: idea.id, indexPath })
    if (!state?.expanded) return
    ;(idea.supportingConnections ?? []).forEach((connection, index) => {
      const child = dataStore.ideas[connection.ideaId]
      if (child) visit(child, state.children?.[child.id], [...indexPath, index])
    })
  }
  topLevelIdeas.forEach((idea, index) => visit(idea, tree[idea.id], [index]))
  return rows
}

export function setCurrentIdeaIndexInState(
  activeColumn: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  setFloatingIdeaIndex: (index: number) => void,
  ideaIndex: number,
  dataStore: DataStore
): void {
  if (activeColumn === -1) {
    setFloatingIdeaIndex(ideaIndex)
    return
  }

  const phaseId = getSelectedPhaseId(activeColumn)
  if (!phaseId) {
    return
  }

  const phase = dataStore.phases[phaseId]
  if (phase) {
    phase.selectedIdeaIndex = ideaIndex
  }
}

export function findPathToIdea(targetId: string, topLevelIdeas: Idea[], dataStore: DataStore): TreeTraversalResult[] | null {
  for (let i = 0; i < topLevelIdeas.length; i++) {
    const root = topLevelIdeas[i]
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
  currentIdea: Idea,
  dataStore: DataStore,
  topLevelIndex: number,
  indexInParent: number | undefined,
  visited: Set<string> = new Set()
): TreeTraversalResult[] | null {
  if (currentIdea.id === targetId) {
    return [{ ideaId: currentIdea.id, topLevelIndex, indexInParent }]
  }

  if (visited.has(currentIdea.id)) {
    return null
  }
  const nextVisited = new Set(visited)
  nextVisited.add(currentIdea.id)

  if (currentIdea.supportingConnections?.length) {
    for (let i = 0; i < currentIdea.supportingConnections.length; i++) {
      const childConnection = currentIdea.supportingConnections[i]
      const childIdea = childConnection ? dataStore.ideas[childConnection.ideaId] : undefined
      if (!childIdea) {
        continue
      }

      const childPath = findPathInTree(targetId, childIdea, dataStore, topLevelIndex, i, nextVisited)
      if (childPath) {
        return [{ ideaId: currentIdea.id, topLevelIndex, indexInParent }, ...childPath]
      }
    }
  }

  return null
}
