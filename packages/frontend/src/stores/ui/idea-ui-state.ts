export type IdeaUIState = {
  expanded: boolean
  pendingDelete: boolean
  selectedIncomingIndex?: number
  children: Record<string, IdeaUIState>
}

export type IdeaUIStateTree = Record<string, IdeaUIState>

export function createAimUIState(): IdeaUIState {
  return {
    expanded: false,
    pendingDelete: false,
    selectedIncomingIndex: undefined,
    children: {}
  }
}

export function ensureAimUIState(tree: IdeaUIStateTree, ideaId: string): IdeaUIState {
  tree[ideaId] ??= createAimUIState()
  tree[ideaId].expanded ??= false
  tree[ideaId].pendingDelete ??= false
  tree[ideaId].children ??= {}
  return tree[ideaId]
}

// `o` inserts next to the selected idea, at its level. The one exception is an
// expanded idea without sub-ideas: its empty child list is the only place a first
// child can go. (An idea with children is entered with `l` and extended there.)
export function insertsAsFirstChild(
  idea: { supportingConnections?: unknown[] } | undefined,
  state: IdeaUIState | undefined,
  insertPosition: 'before' | 'after' | undefined
): boolean {
  return !!idea && !!state?.expanded && insertPosition === 'after' && (idea.supportingConnections?.length ?? 0) === 0
}
