export type AimUIState = {
  expanded: boolean
  pendingDelete: boolean
  selectedIncomingIndex?: number
  children: Record<string, AimUIState>
}

export type AimUIStateTree = Record<string, AimUIState>

export function createAimUIState(): AimUIState {
  return {
    expanded: false,
    pendingDelete: false,
    selectedIncomingIndex: undefined,
    children: {}
  }
}

export function ensureAimUIState(tree: AimUIStateTree, aimId: string): AimUIState {
  tree[aimId] ??= createAimUIState()
  tree[aimId].expanded ??= false
  tree[aimId].pendingDelete ??= false
  tree[aimId].children ??= {}
  return tree[aimId]
}

// `o` inserts next to the selected aim, at its level. The one exception is an
// expanded aim without sub-aims: its empty child list is the only place a first
// child can go. (An aim with children is entered with `l` and extended there.)
export function insertsAsFirstChild(
  aim: { supportingConnections?: unknown[] } | undefined,
  state: AimUIState | undefined,
  insertPosition: 'before' | 'after' | undefined
): boolean {
  return !!aim && !!state?.expanded && insertPosition === 'after' && (aim.supportingConnections?.length ?? 0) === 0
}
