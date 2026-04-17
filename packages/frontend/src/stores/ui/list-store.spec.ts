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
      childPhaseIds: [],
      commitments: []
    } as any
    const root1 = dataStore.phases['root-1']
    if (!root1) throw new Error('root-1 should exist in test setup')
    root1.childPhaseIds = []
    dataStore.meta = { rootPhaseIds: ['root-1', 'root-2'] }

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

  it('restores obvious list UI state after reload', async () => {
    setActivePinia(createPinia())
    const initialDataStore = useDataStore()
    const initialUIStore = useUIStore()
    const initialProjectStore = useProjectStore()

    initialProjectStore.projectPath = '/tmp/project'

    initialDataStore.meta = { rootPhaseIds: ['root-1', 'root-2'] } as any
    initialDataStore.phases['root-1'] = {
      id: 'root-1',
      name: 'Root 1',
      from: 0,
      to: 10,
      parent: null,
      childPhaseIds: [],
      commitments: []
    } as any
    initialDataStore.phases['root-2'] = {
      id: 'root-2',
      name: 'Root 2',
      from: 10,
      to: 20,
      parent: null,
      childPhaseIds: ['child-a', 'child-b'],
      commitments: []
    } as any
    initialDataStore.phases['child-a'] = {
      id: 'child-a',
      name: 'Child A',
      from: 0,
      to: 5,
      parent: 'root-2',
      childPhaseIds: [],
      commitments: []
    } as any
    initialDataStore.phases['child-b'] = {
      id: 'child-b',
      name: 'Child B',
      from: 5,
      to: 10,
      parent: 'root-2',
      childPhaseIds: [],
      commitments: []
    } as any

    initialUIStore.windowSize = 2
    initialUIStore.windowStart = 0
    initialUIStore.activeColumn = 1
    initialUIStore.maxColumn = 1
    initialUIStore.selectedPhaseByColumn[0] = 1
    initialUIStore.selectedPhaseIdByColumn[0] = 'root-2'
    initialUIStore.selectedPhaseByColumn[1] = 1
    initialUIStore.selectedPhaseIdByColumn[1] = 'child-b'
    initialUIStore.lastSelectedSubPhaseIndexByPhase['root-2'] = 1
    initialUIStore.navigatingAims = false

    await initialUIStore.persistProjectUIState()

    setActivePinia(createPinia())
    const restoredDataStore = useDataStore()
    const restoredUIStore = useUIStore()
    const restoredProjectStore = useProjectStore()

    restoredProjectStore.projectPath = '/tmp/project'

    mockTrpc.phase.list.query.mockImplementation(({ parentPhaseId }: { parentPhaseId: string | null }) => {
      if (parentPhaseId === null) {
        return Promise.resolve([
          { id: 'root-1', name: 'Root 1', from: 0, to: 10, parent: null, childPhaseIds: [], commitments: [] },
          { id: 'root-2', name: 'Root 2', from: 10, to: 20, parent: null, childPhaseIds: ['child-a', 'child-b'], commitments: [] }
        ])
      }

      if (parentPhaseId === 'root-1') {
        return Promise.resolve([])
      }

      if (parentPhaseId === 'root-2') {
        return Promise.resolve([
          { id: 'child-a', name: 'Child A', from: 0, to: 5, parent: 'root-2', childPhaseIds: [], commitments: [] },
          { id: 'child-b', name: 'Child B', from: 5, to: 10, parent: 'root-2', childPhaseIds: [], commitments: [] }
        ])
      }

      return Promise.resolve([])
    })

    const restored = await restoredUIStore.restoreProjectUIState()

    expect(restored).toBe(true)
    expect(restoredUIStore.windowSize).toBe(2)
    expect(restoredUIStore.windowStart).toBe(0)
    expect(restoredUIStore.activeColumn).toBe(1)
    expect(restoredUIStore.selectedPhaseIdByColumn[0]).toBe('root-2')
    expect(restoredUIStore.getSelectedPhase(0)).toBe(1)
    expect(restoredUIStore.selectedPhaseIdByColumn[1]).toBe('child-b')
    expect(restoredUIStore.getSelectedPhaseEntry(1)?.type).toBe('phase')
    const selectedEntry = restoredUIStore.getSelectedPhaseEntry(1)
    expect(selectedEntry && selectedEntry.type === 'phase' ? selectedEntry.phase.id : null).toBe('child-b')
  })
})
