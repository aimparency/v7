import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { mockTrpc } = vi.hoisted(() => ({
  mockTrpc: {
    aim: {
      get: { query: vi.fn() },
      update: { mutate: vi.fn() },
      commitToPhase: { mutate: vi.fn() },
      connectAims: { mutate: vi.fn() },
      removeFromPhase: { mutate: vi.fn() }
    },
    phase: {
      get: { query: vi.fn() }
    }
  }
}))

vi.mock('../trpc', () => ({
  trpc: mockTrpc
}))

vi.mock('shared', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    calculateAimValues: vi.fn(() => ({
      values: new Map(),
      costs: new Map(),
      doneCosts: new Map(),
      priorities: new Map(),
      flowShares: new Map(),
      flowValues: new Map(),
      totalIntrinsic: 0
    }))
  }
})

import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

function baseAim(id: string, text: string) {
  return {
    id,
    text,
    description: '',
    tags: [],
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    supportedAims: [],
    committedIn: [],
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 0
  }
}

describe('UI teleport cut/paste', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('cuts with x and reorders in same phase with p', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'
    uiStore.navigatingAims = true
    uiStore.activeColumn = 0
    uiStore.selectedPhaseIdByColumn[0] = 'phase-1'
    uiStore.selectedPhaseByColumn[0] = 0
    dataStore.meta = { rootPhaseIds: ['phase-1'] }

    dataStore.phases['phase-1'] = {
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: ['aim-1', 'aim-2'],
      selectedAimIndex: 1
    } as any

    dataStore.aims['aim-1'] = baseAim('aim-1', 'A1') as any
    dataStore.aims['aim-2'] = baseAim('aim-2', 'A2') as any

    mockTrpc.aim.get.query.mockResolvedValue(baseAim('aim-2', 'A2'))
    mockTrpc.phase.get.query.mockResolvedValue({
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      commitments: ['aim-1', 'aim-2']
    })

    await uiStore.handleAimNavigationKeys(keyEvent('x'), dataStore)
    const modalStore = useUIModalStore()
    expect(modalStore.teleportCutAimId).toBe('aim-2')
    expect(modalStore.movingAimId).toBe('aim-2')

    const selectedPhase = dataStore.phases['phase-1']
    if (!selectedPhase) throw new Error('phase-1 should exist in test setup')
    selectedPhase.selectedAimIndex = 0
    await uiStore.handleAimNavigationKeys(keyEvent('p'), dataStore)

    expect(mockTrpc.aim.commitToPhase.mutate).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      aimId: 'aim-2',
      phaseId: 'phase-1',
      insertionIndex: 1
    })
    expect(modalStore.teleportCutAimId).toBeNull()
    expect(modalStore.movingAimId).toBeNull()
  })

  it('moves from one parent to another on paste', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'
    uiStore.navigatingAims = true
    uiStore.activeColumn = 0
    uiStore.selectedPhaseIdByColumn[0] = 'phase-1'
    uiStore.selectedPhaseByColumn[0] = 0
    dataStore.meta = { rootPhaseIds: ['phase-1'] }

    const parentA = baseAim('parent-a', 'Parent A') as any
    parentA.supportingConnections = [{ aimId: 'child', weight: 1, relativePosition: [0, 0] }]
    parentA.expanded = true
    parentA.selectedIncomingIndex = 0

    const parentB = baseAim('parent-b', 'Parent B') as any
    parentB.supportingConnections = [{ aimId: 'target', weight: 1, relativePosition: [0, 0] }]
    parentB.expanded = true
    parentB.selectedIncomingIndex = 0

    const child = baseAim('child', 'Child') as any
    child.supportedAims = ['parent-a']
    const target = baseAim('target', 'Target') as any
    target.supportedAims = ['parent-b']

    dataStore.aims['parent-a'] = parentA
    dataStore.aims['parent-b'] = parentB
    dataStore.aims['child'] = child
    dataStore.aims['target'] = target

    dataStore.phases['phase-1'] = {
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: ['parent-b'],
      selectedAimIndex: 0
    } as any

    const modalStore = useUIModalStore()
    modalStore.teleportCutAimId = 'child'
    modalStore.teleportSource = { parentAimId: 'parent-a' }
    modalStore.movingAimId = 'child'

    mockTrpc.aim.update.mutate.mockResolvedValue({})
    mockTrpc.aim.connectAims.mutate.mockResolvedValue({})
    mockTrpc.aim.get.query.mockImplementation(({ aimId }: any) => {
      if (aimId === 'parent-a') {
        return Promise.resolve({
          ...parentA,
          supportingConnections: []
        })
      }
      if (aimId === 'parent-b') {
        return Promise.resolve({
          ...parentB,
          supportingConnections: [
            { aimId: 'target', weight: 1, relativePosition: [0, 0] },
            { aimId: 'child', weight: 1, relativePosition: [0, 0] }
          ]
        })
      }
      return Promise.resolve({
        ...child,
        supportedAims: ['parent-b']
      })
    })

    await uiStore.pasteCutAim(dataStore)

    expect(mockTrpc.aim.update.mutate).toHaveBeenCalled()
    expect(mockTrpc.aim.connectAims.mutate).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      parentAimId: 'parent-b',
      childAimId: 'child',
      parentIncomingIndex: 1
    })
    expect(modalStore.teleportCutAimId).toBeNull()
  })

  it('opens create modal in aim-navigation for an empty selected phase', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const modalStore = useUIModalStore()

    uiStore.navigatingAims = true
    modalStore.showAimModal = false
    uiStore.activeColumn = 0
    uiStore.selectedPhaseIdByColumn[0] = 'phase-empty'

    dataStore.phases['phase-empty'] = {
      id: 'phase-empty',
      name: 'Empty',
      from: 0,
      to: 1,
      parent: null,
      commitments: [],
      selectedAimIndex: undefined
    } as any

    await uiStore.handleAimNavigationKeys(keyEvent('o'), dataStore)

    expect(modalStore.showAimModal).toBe(true)
    expect(modalStore.aimModalInsertPosition).toBe('after')
  })

  it('does not enter aim mode with i when selected column has no phases', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()

    uiStore.navigatingAims = false
    uiStore.activeColumn = 0
    dataStore.meta = { rootPhaseIds: [] }

    await uiStore.handleColumnNavigationKeys(keyEvent('i'), dataStore)

    expect(uiStore.navigatingAims).toBe(false)
  })

  it('enters aim mode with i when selected phase exists even if it has no aims', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()

    uiStore.navigatingAims = false
    uiStore.activeColumn = 0
    uiStore.selectedPhaseByColumn[0] = 0
    uiStore.selectedPhaseIdByColumn[0] = 'phase-empty'
    dataStore.meta = { rootPhaseIds: ['phase-empty'] }
    dataStore.phases['phase-empty'] = {
      id: 'phase-empty',
      name: 'Empty',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: [],
      selectedAimIndex: undefined
    } as any

    await uiStore.handleColumnNavigationKeys(keyEvent('i'), dataStore)

    expect(uiStore.navigatingAims).toBe(true)
  })

  it('deletes selected phase on second d press', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'
    uiStore.activeColumn = 0
    uiStore.selectedPhaseByColumn[0] = 0
    uiStore.selectedPhaseIdByColumn[0] = 'phase-1'
    dataStore.meta = { rootPhaseIds: ['phase-1'] }
    dataStore.phases['phase-1'] = {
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: []
    } as any

    mockTrpc.phase.get.query.mockResolvedValue({
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      commitments: []
    })

    const deletePhaseSpy = vi.spyOn(dataStore, 'deletePhase').mockResolvedValue(undefined as any)
    const loadPhasesSpy = vi.spyOn(dataStore, 'loadPhases').mockResolvedValue([])

    await uiStore.handleColumnNavigationKeys(keyEvent('d'), dataStore)
    expect(uiStore.pendingDeletePhaseId).toBe('phase-1')

    await uiStore.handleColumnNavigationKeys(keyEvent('d'), dataStore)
    expect(deletePhaseSpy).toHaveBeenCalledWith('phase-1', null)
    expect(loadPhasesSpy).toHaveBeenCalled()
    expect(uiStore.pendingDeletePhaseId).toBeNull()
  })
})
