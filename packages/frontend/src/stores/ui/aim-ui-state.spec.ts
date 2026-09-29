import { describe, expect, it } from 'vitest'
import { createAimUIState, ensureAimUIState, insertsAsFirstChild, type AimUIStateTree } from './aim-ui-state'

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

describe('insertsAsFirstChild', () => {
  const expanded = { ...createAimUIState(), expanded: true }

  it('adds the first child to an expanded aim without sub-aims', () => {
    expect(insertsAsFirstChild({ supportingConnections: [] }, expanded, 'after')).toBe(true)
  })

  it('stays at the selected level once the aim has sub-aims (e.g. after h back to the parent)', () => {
    expect(insertsAsFirstChild({ supportingConnections: [{}] }, expanded, 'after')).toBe(false)
  })

  it('never nests for O or collapsed aims', () => {
    expect(insertsAsFirstChild({ supportingConnections: [] }, expanded, 'before')).toBe(false)
    expect(insertsAsFirstChild({ supportingConnections: [] }, createAimUIState(), 'after')).toBe(false)
  })
})
