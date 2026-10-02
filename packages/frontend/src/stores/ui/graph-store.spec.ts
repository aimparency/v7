import { describe, expect, it } from 'vitest'
import { findConnectionBetween } from './graph-store'

describe('findConnectionBetween', () => {
  const ideas = {
    parent: { supportingConnections: [{ ideaId: 'child' }] },
    child: { supportingConnections: [] },
    unrelated: { supportingConnections: [] },
  }

  it('returns the stored parent-child orientation from either click order', () => {
    expect(findConnectionBetween('parent', 'child', ideas)).toEqual({
      parentId: 'parent',
      childId: 'child',
    })
    expect(findConnectionBetween('child', 'parent', ideas)).toEqual({
      parentId: 'parent',
      childId: 'child',
    })
  })

  it('does not invent a connection for unrelated ideas', () => {
    expect(findConnectionBetween('parent', 'unrelated', ideas)).toBeNull()
  })
})
