import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onData: null as null | ((event: unknown) => void),
  resolveSnapshot: null as null | ((snapshot: unknown) => void)
}))

vi.mock('../../trpc', () => ({
  trpc: {
    activity: {
      onAccess: {
        subscribe: vi.fn((_input, opts) => {
          mocks.onData = opts.onData
          return { unsubscribe: vi.fn() }
        })
      },
      snapshot: { query: vi.fn(() => new Promise((resolve) => { mocks.resolveSnapshot = resolve })) }
    }
  }
}))

import { addAccess } from 'shared'
import { followIdeaActivity, ideaActivity } from '../idea-activity-feed'

describe('idea activity feed', () => {
  it('adds accesses that arrived while the snapshot loaded, unless it has them already', async () => {
    followIdeaActivity('/project')
    const event = (seq: number, at: number) => ({ projectPath: '/project', ideaIds: ['idea-1'], kind: 'read', at, seq })
    mocks.onData!(event(2, 2000)) // already in the snapshot
    mocks.onData!(event(3, 3000)) // newer than the snapshot
    const snapshotRead = addAccess(addAccess(undefined, 'read', 1000), 'read', 2000)
    mocks.resolveSnapshot!({ seq: 2, ideas: { 'idea-1': snapshotRead, 'idea-2': { write: 0.5 } } })
    await vi.waitFor(() => expect(ideaActivity.size).toBe(2))

    expect(ideaActivity.get('idea-1')).toEqual(addAccess(snapshotRead, 'read', 3000))
    mocks.onData!(event(4, 4000)) // after the snapshot: applied right away
    expect(ideaActivity.get('idea-1')).toEqual(addAccess(addAccess(snapshotRead, 'read', 3000), 'read', 4000))
    expect(ideaActivity.get('idea-2')).toEqual({ write: 0.5 })
  })
})
