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

import { followIdeaActivity, ideaActivity } from '../idea-activity-feed'

describe('idea activity feed', () => {
  it('merges the snapshot under accesses that arrived while it loaded', async () => {
    followIdeaActivity('/project')
    mocks.onData!({ projectPath: '/project', ideaIds: ['idea-1'], kind: 'read', at: 2000 })
    mocks.resolveSnapshot!({ 'idea-1': { read: 1000, found: 500 }, 'idea-2': { write: 900 } })
    await vi.waitFor(() => expect(ideaActivity.size).toBe(2))

    expect(ideaActivity.get('idea-1')).toEqual({ read: 2000, found: 500 })
    expect(ideaActivity.get('idea-2')).toEqual({ write: 900 })
  })
})
