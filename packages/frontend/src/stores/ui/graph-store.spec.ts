import { describe, expect, it } from 'vitest'
import { findConnectionBetween } from './graph-store'

describe('findConnectionBetween', () => {
  const aims = {
    parent: { supportingConnections: [{ aimId: 'child' }] },
    child: { supportingConnections: [] },
    unrelated: { supportingConnections: [] },
  }

  it('returns the stored parent-child orientation from either click order', () => {
    expect(findConnectionBetween('parent', 'child', aims)).toEqual({
      parentId: 'parent',
      childId: 'child',
    })
    expect(findConnectionBetween('child', 'parent', aims)).toEqual({
      parentId: 'parent',
      childId: 'child',
    })
  })

  it('does not invent a connection for unrelated aims', () => {
    expect(findConnectionBetween('parent', 'unrelated', aims)).toBeNull()
  })
})
