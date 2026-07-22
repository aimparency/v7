import { describe, expect, it } from 'vitest'
import { ensureAimUIState, type AimUIStateTree } from './aim-ui-state'

describe('aim UI state', () => {
  it('keeps delete confirmation local to each rendered aim instance', () => {
    const firstTree: AimUIStateTree = {}
    const secondTree: AimUIStateTree = {}

    ensureAimUIState(firstTree, 'shared-aim').pendingDelete = true

    expect(ensureAimUIState(firstTree, 'shared-aim').pendingDelete).toBe(true)
    expect(ensureAimUIState(secondTree, 'shared-aim').pendingDelete).toBe(false)
  })

  it('adds the transient flag to older persisted UI state', () => {
    const tree = {
      aim: { expanded: true, children: {} }
    } as unknown as AimUIStateTree

    expect(ensureAimUIState(tree, 'aim').pendingDelete).toBe(false)
  })
})
