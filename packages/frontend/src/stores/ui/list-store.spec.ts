import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { mockTrpc } = vi.hoisted(() => ({
  mockTrpc: {
    project: {
      getMeta: { query: vi.fn() }
    },
    phase: {
      get: { query: vi.fn() }
    },
    aim: {
      merge: { mutate: vi.fn() },
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

  it('keeps multi-select mode explicit and exits when the last aim is toggled off', () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    dataStore.aims['aim-a'] = { id: 'aim-a', text: 'A' } as any
    dataStore.aims['aim-b'] = { id: 'aim-b', text: 'B' } as any

    uiStore.enterMultiSelect('aim-a')
    expect(uiStore.multiSelectMode).toBe(true)
    expect(uiStore.multiSelectedAimIds).toEqual(['aim-a'])

    uiStore.toggleMultiSelect('aim-b')
    expect(uiStore.multiSelectedAimIds).toEqual(['aim-a', 'aim-b'])

    uiStore.toggleMultiSelect('aim-a')
    expect(uiStore.multiSelectMode).toBe(true)
    expect(uiStore.multiSelectedAimIds).toEqual(['aim-b'])

    uiStore.toggleMultiSelect('aim-b')
    expect(uiStore.multiSelectMode).toBe(false)
    expect(uiStore.multiSelectedAimIds).toEqual([])
  })

  it('merges selected sources into the target and refreshes the local graph', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'
    dataStore.aims = {
      target: { id: 'target', text: 'Target' },
      source: { id: 'source', text: 'Source' }
    } as any
    const loadAllAims = vi.spyOn(dataStore, 'loadAllAims').mockResolvedValue(undefined)
    mockTrpc.aim.merge.mutate.mockResolvedValue({ success: true, archivedSource: 'source' })
    uiStore.multiSelectedAimIds = ['target', 'source']
    uiStore.multiSelectMode = true

    const result = await uiStore.mergeSelectedInto('target')

    expect(mockTrpc.aim.merge.mutate).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      targetId: 'target',
      sourceId: 'source'
    })
    expect(loadAllAims).toHaveBeenCalledWith('/tmp/project')
    expect(result).toMatchObject({ success: true, mergedCount: 1, failedCount: 0 })
    expect(uiStore.multiSelectedAimIds).toEqual([])
  })

  it('reports partial merge failures with accurate counts', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'
    dataStore.aims = {
      target: { id: 'target', text: 'Target' },
      source1: { id: 'source1', text: 'Source 1' },
      source2: { id: 'source2', text: 'Source 2' }
    } as any
    vi.spyOn(dataStore, 'loadAllAims').mockResolvedValue(undefined)
    mockTrpc.aim.merge.mutate
      .mockResolvedValueOnce({ success: true, archivedSource: 'source1' })
      .mockRejectedValueOnce(new Error('merge conflict'))
    uiStore.multiSelectedAimIds = ['target', 'source1', 'source2']
    uiStore.multiSelectMode = true

    const result = await uiStore.mergeSelectedInto('target')

    expect(result).toMatchObject({
      success: false,
      partial: true,
      mergedCount: 1,
      failedCount: 1
    })
    expect(result.results).toHaveLength(2)
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
      childPhaseIds: ['child-a', 'child-b'],
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
    dataStore.meta = { rootPhaseIds: ['root-1', 'root-2'] }
    uiStore.selectedEntryKeyByColumn[0] = 'phase:root-1'
    uiStore.selectedEntryKeyByColumn[1] = 'phase:child-b'

    uiStore.lastSelectedSubPhaseIndexByPhase['root-1'] = 0

    mockTrpc.phase.get.query.mockImplementation(({ phaseId }: { phaseId: string }) => {
      if (phaseId === 'root-1') {
        return Promise.resolve({ id: 'root-1', name: 'Root 1', from: 0, to: 10, parent: null, childPhaseIds: ['child-a', 'child-b'], commitments: [] })
      }
      if (phaseId === 'child-a') {
        return Promise.resolve({ id: 'child-a', name: 'Child A', from: 0, to: 5, parent: 'root-1', childPhaseIds: [], commitments: [] })
      }
      if (phaseId === 'child-b') {
        return Promise.resolve({ id: 'child-b', name: 'Child B', from: 5, to: 10, parent: 'root-1', childPhaseIds: [], commitments: [] })
      }
      throw new Error(`unexpected phase ${phaseId}`)
    })

    await uiStore.selectPhase(0, 0)

    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-b')
    expect(uiStore.getSelectedPhase(1)).toBe(1)
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
    initialUIStore.selectedEntryKeyByColumn[0] = 'phase:root-2'
    initialUIStore.selectedEntryKeyByColumn[1] = 'phase:child-b'
    initialUIStore.lastSelectedSubPhaseIndexByPhase['root-2'] = 1
    initialUIStore.navigatingAims = false

    await initialUIStore.persistProjectUIState()

    setActivePinia(createPinia())
    const restoredDataStore = useDataStore()
    const restoredUIStore = useUIStore()
    const restoredProjectStore = useProjectStore()

    restoredProjectStore.projectPath = '/tmp/project'

    mockTrpc.project.getMeta.query.mockResolvedValue({ rootPhaseIds: ['root-1', 'root-2'] })
    mockTrpc.phase.get.query.mockImplementation(({ phaseId }: { phaseId: string }) => {
      if (phaseId === 'root-1') {
        return Promise.resolve({ id: 'root-1', name: 'Root 1', from: 0, to: 10, parent: null, childPhaseIds: [], commitments: [] })
      }
      if (phaseId === 'root-2') {
        return Promise.resolve({ id: 'root-2', name: 'Root 2', from: 10, to: 20, parent: null, childPhaseIds: ['child-a', 'child-b'], commitments: [] })
      }
      if (phaseId === 'child-a') {
        return Promise.resolve({ id: 'child-a', name: 'Child A', from: 0, to: 5, parent: 'root-2', childPhaseIds: [], commitments: [] })
      }
      if (phaseId === 'child-b') {
        return Promise.resolve({ id: 'child-b', name: 'Child B', from: 5, to: 10, parent: 'root-2', childPhaseIds: [], commitments: [] })
      }
      throw new Error(`unexpected phase ${phaseId}`)
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

  it('prefers the authoritative cursor chain and focuses its deepest phase on startup', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'
    dataStore.meta = {
      rootPhaseIds: ['root-a', 'root-b'],
      phaseCursors: { '0': 'root-b', '1': 'child-b', '2': 'grandchild-b' },
      phaseActiveLevel: 0
    } as any
    dataStore.phases = {
      'root-a': { id: 'root-a', name: 'Root A', parent: null, childPhaseIds: [], commitments: [] },
      'root-b': { id: 'root-b', name: 'Root B', parent: null, childPhaseIds: ['child-b'], commitments: [] },
      'child-b': { id: 'child-b', name: 'Child B', parent: 'root-b', childPhaseIds: ['grandchild-b'], commitments: [] },
      'grandchild-b': { id: 'grandchild-b', name: 'Grandchild B', parent: 'child-b', childPhaseIds: [], commitments: [] }
    } as any
    localStorage.setItem(uiStore.getPersistedUIStateKey('/tmp/project'), JSON.stringify({
      currentView: 'columns',
      listViewState: {
        ...uiStore.getListViewStateSnapshot(),
        activeColumn: 0,
        selectedPhaseIdByColumn: { '0': 'root-a' },
        windowSize: 2
      }
    }))

    const restored = await uiStore.restoreProjectUIState()

    expect(restored).toBe(true)
    expect(uiStore.selectedPhaseIdByColumn).toMatchObject({
      0: 'root-b',
      1: 'child-b',
      2: 'grandchild-b'
    })
    expect(uiStore.activeColumn).toBe(2)
    expect(uiStore.maxColumn).toBe(2)
    expect(uiStore.windowStart).toBe(1)
    expect(uiStore.windowSize).toBe(2)
  })

  it('loads the children of every parent in a column on restore, not just the selected parent', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    const childIdsA = Array.from({ length: 10 }, (_, index) => `child-a${index}`)
    const serverPhases: Record<string, any> = {
      'root-a': { id: 'root-a', name: 'Root A', parent: null, childPhaseIds: childIdsA, commitments: [] },
      'root-b': { id: 'root-b', name: 'Root B', parent: null, childPhaseIds: ['child-b0'], commitments: [] },
      'child-b0': { id: 'child-b0', name: 'Child B0', parent: 'root-b', childPhaseIds: [], commitments: [] }
    }
    for (const id of childIdsA) {
      serverPhases[id] = { id, name: id, parent: 'root-a', childPhaseIds: [], commitments: [] }
    }
    mockTrpc.phase.get.query.mockImplementation(({ phaseId }: { phaseId: string }) => Promise.resolve(serverPhases[phaseId]))

    // Only the roots are known locally, as after a reload.
    dataStore.meta = {
      rootPhaseIds: ['root-a', 'root-b'],
      phaseCursors: { '0': 'root-a', '1': 'child-a9' }
    } as any
    dataStore.phases = {
      'root-a': { ...serverPhases['root-a'] },
      'root-b': { ...serverPhases['root-b'] }
    } as any

    await uiStore.restoreProjectUIState()

    const columnOne = dataStore.getSelectableColumnEntries(1)
    expect(columnOne.filter((entry) => entry.type === 'placeholder')).toEqual([])
    expect(columnOne.map((entry) => entry.type === 'phase' ? entry.phase.id : entry.key)).toEqual([...childIdsA, 'child-b0'])
    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-a9')
  })

  it('keeps the current visible child selection when moving right into an already visible column', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'
    projectStore.currentView = 'columns'

    dataStore.meta = { rootPhaseIds: ['root-1'] } as any
    dataStore.phases['root-1'] = {
      id: 'root-1',
      name: 'Root 1',
      from: 0,
      to: 10,
      parent: null,
      childPhaseIds: ['child-a', 'child-b', 'child-c'],
      commitments: []
    } as any
    dataStore.phases['child-a'] = {
      id: 'child-a',
      name: 'Child A',
      from: 0,
      to: 1,
      parent: 'root-1',
      childPhaseIds: [],
      commitments: []
    } as any
    dataStore.phases['child-b'] = {
      id: 'child-b',
      name: 'Child B',
      from: 1,
      to: 2,
      parent: 'root-1',
      childPhaseIds: [],
      commitments: []
    } as any
    dataStore.phases['child-c'] = {
      id: 'child-c',
      name: 'Child C',
      from: 2,
      to: 3,
      parent: 'root-1',
      childPhaseIds: [],
      commitments: []
    } as any

    uiStore.windowStart = 0
    uiStore.windowSize = 2
    uiStore.maxColumn = 1
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:root-1'
    uiStore.selectedEntryKeyByColumn[1] = 'phase:child-c'

    // Simulate older remembered child position that should not override the visible selection.
    uiStore.lastSelectedSubPhaseIndexByPhase['root-1'] = 0

    await uiStore.handleColumnNavigationKeys({
      key: 'l',
      preventDefault: vi.fn()
    } as any, dataStore)

    expect(uiStore.activeColumn).toBe(1)
    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-c')
    expect(uiStore.getSelectedPhase(1)).toBe(2)
  })
})
