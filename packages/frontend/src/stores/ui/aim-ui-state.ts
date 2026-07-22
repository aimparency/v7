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
