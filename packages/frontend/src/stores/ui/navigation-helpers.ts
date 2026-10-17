import { useDataStore, type Idea, type Phase } from '../data'
import { ensureIdeaUIState, type IdeaUIState, type IdeaUIStateTree } from './idea-ui-state'

export type SelectionPath = {
  phase: Phase | undefined
  ideas: Idea[]
  ideaStates: IdeaUIState[]
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

  const childId = state.selectedChildId
  if (state.expanded && childId !== undefined && idea.supportingConnections?.some((connection) => connection.ideaId === childId)) {
    const childIdea = dataStore.ideas[childId]
    if (childIdea) {
      const childState = ensureIdeaUIState(state.children, childIdea.id)
      return makeSelectedIdeaPath(childIdea, childState, path, statePath, dataStore)
    }
  }

  return idea
}

export function getSelectionPathFromState(
  navigatingIdeas: boolean,
  activeColumn: number,
  getSelectedPhaseId: (columnIndex: number) => string | undefined,
  getSelectedTopIdeaId: (phaseId: string | undefined) => string | undefined,
  getFloatingIdeaUIStates: () => IdeaUIStateTree,
  getPhaseIdeaUIStates: (phaseId: string) => IdeaUIStateTree
): SelectionPath {
  const dataStore = useDataStore()
  if (!navigatingIdeas) {
    return { phase: undefined, ideas: [], ideaStates: [] }
  }

  const phaseId = activeColumn === -1 ? undefined : getSelectedPhaseId(activeColumn)
  if (activeColumn !== -1 && !phaseId) {
    return { phase: undefined, ideas: [], ideaStates: [] }
  }

  const phase = phaseId ? dataStore.phases[phaseId] : undefined
  const ideas = phaseId ? dataStore.getIdeasForPhase(phaseId) : dataStore.floatingIdeas
  const selectedId = getSelectedTopIdeaId(phaseId)
  const selectedIdea = ideas.find((idea) => idea.id === selectedId)
  const ideaPath: Idea[] = []
  const statePath: IdeaUIState[] = []
  if (selectedIdea) {
    const tree = phaseId ? getPhaseIdeaUIStates(phaseId) : getFloatingIdeaUIStates()
    makeSelectedIdeaPath(selectedIdea, ensureIdeaUIState(tree, selectedIdea.id), ideaPath, statePath, dataStore)
  }

  return { phase, ideas: ideaPath, ideaStates: statePath }
}

// One row per rendered idea of a list: the top-level ideas and, recursively, the
// children of expanded ideas, in display order. `idPath` is the chain of idea
// ids from the top-level idea down to the row, the encoding of the selection.
export type IdeaRow = { ideaId: string; idPath: string[] }

export function getVisibleIdeaRows(topLevelIdeas: Idea[], tree: IdeaUIStateTree, dataStore: DataStore): IdeaRow[] {
  const rows: IdeaRow[] = []
  const visit = (idea: Idea, state: IdeaUIState | undefined, idPath: string[]) => {
    rows.push({ ideaId: idea.id, idPath })
    if (!state?.expanded) return
    for (const connection of idea.supportingConnections ?? []) {
      const child = dataStore.ideas[connection.ideaId]
      if (child) visit(child, state.children?.[child.id], [...idPath, child.id])
    }
  }
  for (const idea of topLevelIdeas) visit(idea, tree[idea.id], [idea.id])
  return rows
}

// The chain of idea ids from a top-level idea down to `targetId`, depth first.
export function findPathToIdea(targetId: string, topLevelIdeas: Idea[], dataStore: DataStore): string[] | null {
  for (const root of topLevelIdeas) {
    const path = findPathInTree(targetId, root, dataStore)
    if (path) return path
  }
  return null
}

function findPathInTree(targetId: string, currentIdea: Idea, dataStore: DataStore, visited: Set<string> = new Set()): string[] | null {
  if (currentIdea.id === targetId) return [currentIdea.id]
  if (visited.has(currentIdea.id)) return null
  const nextVisited = new Set(visited)
  nextVisited.add(currentIdea.id)

  for (const connection of currentIdea.supportingConnections ?? []) {
    const childIdea = dataStore.ideas[connection.ideaId]
    const childPath = childIdea ? findPathInTree(targetId, childIdea, dataStore, nextVisited) : null
    if (childPath) return [currentIdea.id, ...childPath]
  }
  return null
}
