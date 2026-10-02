import { describe, expect, it } from 'vitest'
import { createIdeaUIState, ensureIdeaUIState, insertsAsFirstChild, type IdeaUIStateTree } from './idea-ui-state'

describe('idea UI state', () => {
  it('keeps delete confirmation local to each rendered idea instance', () => {
    const firstTree: IdeaUIStateTree = {}
    const secondTree: IdeaUIStateTree = {}

    ensureIdeaUIState(firstTree, 'shared-idea').pendingDelete = true

    expect(ensureIdeaUIState(firstTree, 'shared-idea').pendingDelete).toBe(true)
    expect(ensureIdeaUIState(secondTree, 'shared-idea').pendingDelete).toBe(false)
  })

  it('adds the transient flag to older persisted UI state', () => {
    const tree = {
      idea: { expanded: true, children: {} }
    } as unknown as IdeaUIStateTree

    expect(ensureIdeaUIState(tree, 'idea').pendingDelete).toBe(false)
  })
})

describe('insertsAsFirstChild', () => {
  const expanded = { ...createIdeaUIState(), expanded: true }

  it('adds the first child to an expanded idea without sub-ideas', () => {
    expect(insertsAsFirstChild({ supportingConnections: [] }, expanded, 'after')).toBe(true)
  })

  it('stays at the selected level once the idea has sub-ideas (e.g. after h back to the parent)', () => {
    expect(insertsAsFirstChild({ supportingConnections: [{}] }, expanded, 'after')).toBe(false)
  })

  it('never nests for O or collapsed ideas', () => {
    expect(insertsAsFirstChild({ supportingConnections: [] }, expanded, 'before')).toBe(false)
    expect(insertsAsFirstChild({ supportingConnections: [] }, createIdeaUIState(), 'after')).toBe(false)
  })
})
