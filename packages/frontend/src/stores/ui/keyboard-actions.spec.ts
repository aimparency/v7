import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { handleColumnNavigationKeysAction, handleGraphKeydownAction } from './keyboard-actions'
import { useGraphUIStore } from './graph-store'
import { useProjectStore } from '../project-store'
import { useDataStore } from '../data'
import { useUIStore } from './list-store'

const makeAim = (id: string, text: string) => ({
  id,
  text,
  description: '',
  supportedAims: [] as string[],
  supportingConnections: [] as Array<{ aimId: string, weight: number, relativePosition: [number, number] }>,
  status: { state: 'open', comment: '', date: 0 },
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 1,
  incoming: [] as string[],
  committedIn: [] as string[]
})

describe('keyboard actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('deletes a selected graph connection on confirmed dd', async () => {
    const graphStore = useGraphUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    const parent = makeAim('parent', 'Parent')
    const child = makeAim('child', 'Child')
    parent.supportingConnections = [
      { aimId: 'child', weight: 1, relativePosition: [0, 0] }
    ]
    child.supportedAims = ['parent']

    const dataStore = {
      aims: { parent, child },
      replaceAim: vi.fn((id: string, aim: any) => {
        dataStore.aims[id as 'parent' | 'child'] = aim
      }),
      recalculateValues: vi.fn(),
      updateAim: vi.fn().mockResolvedValue(undefined)
    }

    graphStore.selectLink('parent', 'child')

    await handleGraphKeydownAction({}, new KeyboardEvent('keydown', { key: 'd' }), dataStore)
    expect(graphStore.pendingDeleteLink).toEqual({ parentId: 'parent', childId: 'child' })
    expect(dataStore.updateAim).not.toHaveBeenCalled()

    await handleGraphKeydownAction({}, new KeyboardEvent('keydown', { key: 'd' }), dataStore)

    expect(graphStore.selectedLink).toBe(null)
    expect(dataStore.aims.parent.supportingConnections).toEqual([])
    expect(dataStore.aims.child.supportedAims).toEqual([])
    expect(dataStore.updateAim).toHaveBeenCalledWith('/tmp/project', 'parent', {
      supportingConnections: []
    })
    expect(dataStore.updateAim).toHaveBeenCalledWith('/tmp/project', 'child', {
      supportedAims: []
    })
  })

  it('moves a phase across parent boundaries and repairs the selected parent path', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    dataStore.meta = { rootPhaseIds: ['root-a', 'root-b'] } as any
    dataStore.phases = {
      'root-a': {
        id: 'root-a',
        name: 'Root A',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-a'],
        commitments: []
      },
      'root-b': {
        id: 'root-b',
        name: 'Root B',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-b'],
        commitments: []
      },
      'child-a': {
        id: 'child-a',
        name: 'Child A',
        from: 0,
        to: 0,
        parent: 'root-a',
        childPhaseIds: [],
        commitments: []
      },
      'child-b': {
        id: 'child-b',
        name: 'Child B',
        from: 0,
        to: 0,
        parent: 'root-b',
        childPhaseIds: [],
        commitments: []
      }
    } as any

    vi.spyOn(dataStore, 'loadPhases').mockResolvedValue([] as any)
    const movePhase = vi.spyOn(dataStore, 'movePhase').mockImplementation(async (_projectPath, phaseId, parentId, newIndex) => {
      const phase = dataStore.phases[phaseId]
      if (!phase || !phase.parent || !parentId) throw new Error('invalid test phase move')
      const oldParent = dataStore.phases[phase.parent!]
      const newParent = dataStore.phases[parentId!]
      if (!oldParent || !newParent) throw new Error('invalid test phase parent')
      oldParent.childPhaseIds = oldParent.childPhaseIds?.filter((id) => id !== phaseId) ?? []
      const nextChildIds = [...(newParent.childPhaseIds ?? [])]
      nextChildIds.splice(newIndex, 0, phaseId)
      newParent.childPhaseIds = nextChildIds
      phase.parent = parentId
    })

    uiStore.activeColumn = 1
    uiStore.maxColumn = 1
    uiStore.windowStart = 0
    uiStore.windowSize = 2
    uiStore.selectedPhaseByColumn[0] = 0
    uiStore.selectedPhaseIdByColumn[0] = 'root-a'
    uiStore.selectedPhaseByColumn[1] = 0
    uiStore.selectedPhaseIdByColumn[1] = 'child-a'

    await handleColumnNavigationKeysAction(uiStore, {
      key: 'J',
      preventDefault: vi.fn()
    } as any, dataStore)

    expect(movePhase).toHaveBeenCalledWith('/tmp/project', 'child-a', 'root-b', 0)
    expect(dataStore.phases['root-a']?.childPhaseIds).toEqual([])
    expect(dataStore.phases['root-b']?.childPhaseIds).toEqual(['child-a', 'child-b'])
    expect(uiStore.selectedPhaseIdByColumn[0]).toBe('root-b')
    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-a')
  })

  it('moves a phase upward after the previous parent children when crossing parent boundaries', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    dataStore.meta = { rootPhaseIds: ['root-a', 'root-b'] } as any
    dataStore.phases = {
      'root-a': {
        id: 'root-a',
        name: 'Root A',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-a1', 'child-a2'],
        commitments: []
      },
      'root-b': {
        id: 'root-b',
        name: 'Root B',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-b'],
        commitments: []
      },
      'child-a1': {
        id: 'child-a1',
        name: 'Child A1',
        from: 0,
        to: 0,
        parent: 'root-a',
        childPhaseIds: [],
        commitments: []
      },
      'child-a2': {
        id: 'child-a2',
        name: 'Child A2',
        from: 0,
        to: 0,
        parent: 'root-a',
        childPhaseIds: [],
        commitments: []
      },
      'child-b': {
        id: 'child-b',
        name: 'Child B',
        from: 0,
        to: 0,
        parent: 'root-b',
        childPhaseIds: [],
        commitments: []
      }
    } as any

    vi.spyOn(dataStore, 'loadPhases').mockResolvedValue([] as any)
    const movePhase = vi.spyOn(dataStore, 'movePhase').mockImplementation(async (_projectPath, phaseId, parentId, newIndex) => {
      const phase = dataStore.phases[phaseId]
      if (!phase || !phase.parent || !parentId) throw new Error('invalid test phase move')
      const oldParent = dataStore.phases[phase.parent!]
      const newParent = dataStore.phases[parentId!]
      if (!oldParent || !newParent) throw new Error('invalid test phase parent')
      oldParent.childPhaseIds = oldParent.childPhaseIds?.filter((id) => id !== phaseId) ?? []
      const nextChildIds = [...(newParent.childPhaseIds ?? [])]
      nextChildIds.splice(newIndex, 0, phaseId)
      newParent.childPhaseIds = nextChildIds
      phase.parent = parentId
    })

    uiStore.activeColumn = 1
    uiStore.maxColumn = 1
    uiStore.windowStart = 0
    uiStore.windowSize = 2
    uiStore.selectedPhaseByColumn[0] = 1
    uiStore.selectedPhaseIdByColumn[0] = 'root-b'
    uiStore.selectedPhaseByColumn[1] = 2
    uiStore.selectedPhaseIdByColumn[1] = 'child-b'

    await handleColumnNavigationKeysAction(uiStore, {
      key: 'K',
      preventDefault: vi.fn()
    } as any, dataStore)

    expect(movePhase).toHaveBeenCalledWith('/tmp/project', 'child-b', 'root-a', 2)
    expect(dataStore.phases['root-a']?.childPhaseIds).toEqual(['child-a1', 'child-a2', 'child-b'])
    expect(dataStore.phases['root-b']?.childPhaseIds).toEqual([])
    expect(uiStore.selectedPhaseIdByColumn[0]).toBe('root-a')
    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-b')
  })
})
