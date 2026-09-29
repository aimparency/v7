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

    dataStore.phases['child-a'] = { id: 'child-a', name: 'Child A', parent: 'root-1', childPhaseIds: [], commitments: [] } as any
    dataStore.phases['child-b'] = { id: 'child-b', name: 'Child B', parent: 'root-1', childPhaseIds: [], commitments: [] } as any

    await uiStore.selectPhase(0, 0)

    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-b')
    expect(uiStore.getSelectedPhase(1)).toBe(1)
  })

  it('reports a selected phase that is absent mid-move as missing instead of the first entry', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const phase = (id: string, parent: string | null, childPhaseIds: string[] = []) =>
      ({ id, name: id, parent, childPhaseIds, commitments: [] }) as any

    dataStore.phases['root-a'] = phase('root-a', null, ['child-a', 'moving'])
    dataStore.phases['root-b'] = phase('root-b', null, ['child-b'])
    dataStore.phases['child-a'] = phase('child-a', 'root-a')
    dataStore.phases['child-b'] = phase('child-b', 'root-b')
    dataStore.phases['moving'] = phase('moving', 'root-a')
    dataStore.meta = { rootPhaseIds: ['root-a', 'root-b'] }
    uiStore.activeColumn = 1
    uiStore.selectedEntryKeyByColumn[0] = 'phase:root-a'
    uiStore.selectedEntryKeyByColumn[1] = 'phase:moving'

    // First push of a parent change: the old parent no longer lists the phase,
    // the new parent does not list it yet.
    dataStore.phases['root-a'] = phase('root-a', null, ['child-a'])

    expect(uiStore.findSelectedPhaseIndex(1)).toBe(-1)
    expect(uiStore.getSelectedPhaseEntry(1)).toBeUndefined()
    // j during the gap must not navigate from a stand-in position.
    expect(await uiStore.moveActivePhase(1)).toBe(true)
    expect(uiStore.selectedEntryKeyByColumn[1]).toBe('phase:moving')

    dataStore.phases['root-b'] = phase('root-b', null, ['moving', 'child-b'])
    expect(uiStore.getSelectedPhaseEntry(1)).toMatchObject({ key: 'phase:moving', parentPhaseId: 'root-b' })
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

    // loadProject loads the whole phase tree before the UI state is restored.
    restoredDataStore.meta = initialDataStore.meta
    restoredDataStore.phases = JSON.parse(JSON.stringify(initialDataStore.phases))

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

  const seedCursorProject = () => {
    const dataStore = useDataStore()
    useProjectStore().projectPath = '/tmp/project'
    dataStore.meta = {
      rootPhaseIds: ['root-a', 'root-b'],
      phaseCursors: { '0': 'root-b', '1': 'child-b', '2': 'grandchild-b' },
      phaseActiveLevel: 0
    } as any
    dataStore.phases = {
      'root-a': { id: 'root-a', name: 'Root A', parent: null, childPhaseIds: [], commitments: [] },
      'root-b': { id: 'root-b', name: 'Root B', parent: null, childPhaseIds: ['child-b'], commitments: [] },
      'child-b': { id: 'child-b', name: 'Child B', parent: 'root-b', childPhaseIds: ['grandchild-b'], commitments: ['aim-1', 'aim-2'] },
      'grandchild-b': { id: 'grandchild-b', name: 'Grandchild B', parent: 'child-b', childPhaseIds: [], commitments: [] }
    } as any
    dataStore.aims = {
      'aim-1': { id: 'aim-1', text: 'One', supportingConnections: [], supportedAims: [], committedIn: ['child-b'] },
      'aim-2': { id: 'aim-2', text: 'Two', supportingConnections: [{ aimId: 'sub' }], supportedAims: [], committedIn: ['child-b'] },
      sub: { id: 'sub', text: 'Sub', supportingConnections: [], supportedAims: ['aim-2'], committedIn: [] }
    } as any
  }

  it('follows the cursor chain to its deepest phase in a browser without saved state', async () => {
    seedCursorProject()
    const uiStore = useUIStore()

    const restored = await uiStore.restoreProjectUIState()

    expect(restored).toBe(true)
    expect(uiStore.selectedPhaseIdByColumn).toMatchObject({ 0: 'root-b', 1: 'child-b', 2: 'grandchild-b' })
    expect(uiStore.activeColumn).toBe(2)
    expect(uiStore.maxColumn).toBe(2)
  })

  it('restores this browser\'s own selection by identity over the cursor chain', async () => {
    seedCursorProject()
    const uiStore = useUIStore()
    useDataStore().meta!.phaseCursors = { '0': 'root-a' } as any
    localStorage.setItem(uiStore.getPersistedUIStateKey('/tmp/project'), JSON.stringify({
      currentView: 'columns',
      listViewState: {
        ...uiStore.getListViewStateSnapshot(),
        windowSize: 2,
        activeColumn: 1,
        navigatingAims: true,
        // Stale index (aims were reordered since): identity must win.
        selectedAimIndexByPhaseId: { 'child-b': 0 },
        selection: {
          activeColumn: 1,
          maxColumn: 2,
          entryKeyByColumn: { 0: 'phase:root-b', 1: 'phase:child-b', 2: 'phase:grandchild-b' },
          navigatingAims: true,
          aimPath: ['aim-2', 'sub']
        }
      }
    }))

    await uiStore.restoreProjectUIState()

    expect(uiStore.selectedPhaseIdByColumn).toMatchObject({ 0: 'root-b', 1: 'child-b' })
    expect(uiStore.activeColumn).toBe(1)
    expect(uiStore.navigatingAims).toBe(true)
    expect(uiStore.getCurrentAim()?.id).toBe('sub')
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
