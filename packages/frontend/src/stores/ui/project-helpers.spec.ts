import { describe, expect, it } from 'vitest'
import {
  normalizeProjectPath,
  removeProjectFromHistoryEntries,
  setProjectFailureState,
  upsertProjectHistory,
  type ProjectHistoryEntry
} from './project-helpers'

describe('project helpers', () => {
  it('normalizes .bowman suffix variants', () => {
    expect(normalizeProjectPath('/tmp/demo/.bowman')).toBe('/tmp/demo')
    expect(normalizeProjectPath('/tmp/demo/.bowman/')).toBe('/tmp/demo')
    expect(normalizeProjectPath('/tmp/demo')).toBe('/tmp/demo')
  })

  it('upserts project history at top and limits size', () => {
    const history: ProjectHistoryEntry[] = [
      { path: '/a', lastOpened: 1, failedToLoad: false },
      { path: '/b', lastOpened: 2, failedToLoad: true }
    ]

    const updated = upsertProjectHistory(history, '/b', 100)
    expect(updated[0]).toEqual({ path: '/b', lastOpened: 100, failedToLoad: false })
    expect(updated[1]?.path).toBe('/a')
  })

  it('removes and marks failures by normalized path', () => {
    const history: ProjectHistoryEntry[] = [
      { path: '/tmp/demo', lastOpened: 1, failedToLoad: false },
      { path: '/other', lastOpened: 2, failedToLoad: false }
    ]

    const failed = setProjectFailureState(history, '/tmp/demo/.bowman', true)
    expect(failed[0]?.failedToLoad).toBe(true)

    const cleared = setProjectFailureState(failed, '/tmp/demo/.bowman', false)
    expect(cleared[0]?.failedToLoad).toBe(false)

    const removed = removeProjectFromHistoryEntries(cleared, '/tmp/demo/.bowman')
    expect(removed).toEqual([{ path: '/other', lastOpened: 2, failedToLoad: false }])
  })
})
