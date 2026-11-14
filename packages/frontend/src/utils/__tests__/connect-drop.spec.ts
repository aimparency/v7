import { describe, expect, it } from 'vitest'
import { connectDrop } from '../connect-drop'

describe('releasing a connection dragged from an idea', () => {
  it('connects ideas of this graph, links a graph by its node or its outline, and blocks the rest', () => {
    expect(connectDrop({ id: 'a' }, undefined)).toEqual({ kind: 'idea', ideaId: 'a' })
    expect(connectDrop({ id: 'repo', isRepo: true }, undefined)).toEqual({ kind: 'graph', repoId: 'repo' })
    expect(connectDrop(undefined, 'repo')).toEqual({ kind: 'graph', repoId: 'repo' })
    expect(connectDrop({ id: 'repo:x', linked: true }, 'repo')).toEqual({ kind: 'blocked' })
    expect(connectDrop({ id: 'bad', unreadable: 'parse error' }, undefined)).toEqual({ kind: 'blocked' })
    expect(connectDrop(undefined, undefined)).toEqual({ kind: 'new' })
  })
})
