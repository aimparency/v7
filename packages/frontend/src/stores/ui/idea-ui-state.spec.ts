import { describe, expect, it } from 'vitest'
import { createAimUIState, ensureAimUIState, insertsAsFirstChild, type IdeaUIStateTree } from './idea-ui-state'

describe('idea UI state', () => {
  it('keeps delete confirmation local to each rendered idea instance', () => {
    const firstTree: IdeaUIStateTree = {}
    const secondTree: IdeaUIStateTree = {}

    ensureAimUIState(firstTree, 'shared-idea').pendingDelete = true

    expect(ensureAimUIState(firstTree, 'shared-idea').pendingDelete).toBe(true)
    expect(ensureAimUIState(secondTree, 'shared-idea').pendingDelete).toBe(false)
  })

  it('adds the transient flag to older persisted UI state', () => {
    const tree = {
      idea: { expanded: true, children: {} }
    } as unknown as IdeaUIStateTree

    expect(ensureAimUIState(tree, 'idea').pendingDelete).toBe(false)
  })
})

describe('insertsAsFirstChild', () => {
  const expanded = { ...createAimUIState(), expanded: true }

  it('adds the first child to an expanded idea without sub-ideas', () => {
    expect(insertsAsFirstChild({ supportingConnections: [] }, expanded, 'after')).toBe(true)
  })

  it('stays at the selected level once the idea has sub-ideas (e.g. after h back to the parent)', () => {
    expect(insertsAsFirstChild({ supportingConnections: [{}] }, expanded, 'after')).toBe(false)
  })

  it('never nests for O or collapsed ideas', () => {
    expect(insertsAsFirstChild({ supportingConnections: [] }, expanded, 'before')).toBe(false)
    expect(insertsAsFirstChild({ supportingConnections: [] }, createAimUIState(), 'after')).toBe(false)
  })
})
