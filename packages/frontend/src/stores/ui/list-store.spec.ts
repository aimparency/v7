import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { mockTrpc } = vi.hoisted(() => ({
  mockTrpc: {
    phase: {
      list: { query: vi.fn() }
    }
  }
}))

vi.mock('../../trpc', () => ({
  trpc: mockTrpc
}))

import { useDataStore } from '../data'
import { useUIStore } from './list-store'
import { useProjectStore } from '../project-store'

describe('list store phase selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('preserves selected child phase by id when reloading columns', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'

    dataStore.phases['root-1'] = {
      id: 'root-1',
      name: 'Root 1',
      from: 0,
      to: 10,
      parent: null,
      commitments: []
    } as any
    dataStore.phases['root-2'] = {
      id: 'root-2',
      name: 'Root 2',
      from: 10,
      to: 20,
      parent: null,
      commitments: []
    } as any
    dataStore.childrenByParentId.null = ['root-1', 'root-2']

    uiStore.selectedPhaseByColumn[0] = 0
    uiStore.selectedPhaseIdByColumn[0] = 'root-1'

    uiStore.selectedPhaseByColumn[1] = 1
    uiStore.selectedPhaseIdByColumn[1] = 'child-b'

    uiStore.lastSelectedSubPhaseIndexByPhase['root-1'] = 0

    mockTrpc.phase.list.query.mockImplementation(({ parentPhaseId }: { parentPhaseId: string | null }) => {
      if (parentPhaseId === 'root-1') {
        return Promise.resolve([
          { id: 'child-a', name: 'Child A', from: 0, to: 5, parent: 'root-1', commitments: [] },
          { id: 'child-b', name: 'Child B', from: 5, to: 10, parent: 'root-1', commitments: [] }
        ])
      }

      if (parentPhaseId === 'child-b') {
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    await uiStore.selectPhase(0, 0)

    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-b')
    expect(uiStore.selectedPhaseByColumn[1]).toBe(1)
  })
})
