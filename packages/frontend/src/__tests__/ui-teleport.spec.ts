import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { mockTrpc } = vi.hoisted(() => ({
  mockTrpc: {
    idea: {
      getMany: { query: vi.fn() },
      get: { query: vi.fn() },
      update: { mutate: vi.fn() },
      disconnect: { mutate: vi.fn() },
      commitToPhase: { mutate: vi.fn() },
      connectIdeas: { mutate: vi.fn() },
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
    calculateIdeaValues: vi.fn(() => ({
      values: new Map(),
      costs: new Map(),
      doneCosts: new Map(),
      priorities: new Map(),
      flowShares: new Map(),
      flowValues: new Map(),
      attributionShares: new Map(),
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

function baseIdea(id: string, text: string) {
  return {
    id,
    text,
    description: '',
    tags: [],
    status: { state: 'open', comment: '', date: Date.now() },
    supportingConnections: [],
    supportedIdeas: [],
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
    uiStore.navigatingIdeas = true
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:phase-1'
    dataStore.meta = { rootPhaseIds: ['phase-1'] }

    dataStore.phases['phase-1'] = {
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: ['idea-1', 'idea-2'],
      selectedIdeaIndex: 1
    } as any

    dataStore.ideas['idea-1'] = baseIdea('idea-1', 'A1') as any
    dataStore.ideas['idea-2'] = baseIdea('idea-2', 'A2') as any

    mockTrpc.idea.get.query.mockResolvedValue(baseIdea('idea-2', 'A2'))
    mockTrpc.phase.get.query.mockResolvedValue({
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      commitments: ['idea-1', 'idea-2']
    })

    await uiStore.handleIdeaNavigationKeys(keyEvent('x'), dataStore)
    const modalStore = useUIModalStore()
    expect(modalStore.teleportCutIdeaId).toBe('idea-2')
    expect(modalStore.movingIdeaId).toBe('idea-2')

    const selectedPhase = dataStore.phases['phase-1']
    if (!selectedPhase) throw new Error('phase-1 should exist in test setup')
    selectedPhase.selectedIdeaIndex = 0
    await uiStore.handleIdeaNavigationKeys(keyEvent('p'), dataStore)

    expect(mockTrpc.idea.commitToPhase.mutate).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      ideaId: 'idea-2',
      phaseId: 'phase-1',
      insertionIndex: 1
    })
    expect(modalStore.teleportCutIdeaId).toBeNull()
    expect(modalStore.movingIdeaId).toBeNull()
  })

  it('moves from one parent to another on paste', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'
    uiStore.navigatingIdeas = true
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:phase-1'
    dataStore.meta = { rootPhaseIds: ['phase-1'] }

    const parentA = baseIdea('parent-a', 'Parent A') as any
    parentA.supportingConnections = [{ ideaId: 'child', weight: 1, relativePosition: [0, 0] }]

    const parentB = baseIdea('parent-b', 'Parent B') as any
    parentB.supportingConnections = [{ ideaId: 'target', weight: 1, relativePosition: [0, 0] }]

    const child = baseIdea('child', 'Child') as any
    child.supportedIdeas = ['parent-a']
    const target = baseIdea('target', 'Target') as any
    target.supportedIdeas = ['parent-b']

    dataStore.ideas['parent-a'] = parentA
    dataStore.ideas['parent-b'] = parentB
    dataStore.ideas['child'] = child
    dataStore.ideas['target'] = target

    dataStore.phases['phase-1'] = {
      id: 'phase-1',
      name: 'P1',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: ['parent-b'],
      selectedIdeaIndex: 0
    } as any

    const modalStore = useUIModalStore()
    modalStore.teleportCutIdeaId = 'child'
    modalStore.teleportSource = { parentIdeaId: 'parent-a' }
    modalStore.movingIdeaId = 'child'

    const parentBState = uiStore.ensureIdeaUIState(uiStore.getPhaseIdeaUIStates('phase-1'), 'parent-b')
    parentBState.expanded = true
    parentBState.selectedIncomingIndex = 0

    mockTrpc.idea.disconnect.mutate.mockResolvedValue({})
    mockTrpc.idea.connectIdeas.mutate.mockResolvedValue({})
    mockTrpc.idea.get.query.mockImplementation(({ ideaId }: any) => {
      if (ideaId === 'parent-a') {
        return Promise.resolve({
          ...parentA,
          supportingConnections: []
        })
      }
      if (ideaId === 'parent-b') {
        return Promise.resolve({
          ...parentB,
          supportingConnections: [
            { ideaId: 'target', weight: 1, relativePosition: [0, 0] },
            { ideaId: 'child', weight: 1, relativePosition: [0, 0] }
          ]
        })
      }
      return Promise.resolve({
        ...child,
        supportedIdeas: ['parent-b']
      })
    })

    await uiStore.pasteCutIdea(dataStore)

    expect(mockTrpc.idea.disconnect.mutate).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      parentIdeaId: 'parent-a',
      childIdeaId: 'child'
    })
    expect(mockTrpc.idea.connectIdeas.mutate).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      parentIdeaId: 'parent-b',
      childIdeaId: 'child',
      parentIncomingIndex: 1
    })
    expect(modalStore.teleportCutIdeaId).toBeNull()
  })

  it('opens create modal in idea-navigation for an empty selected phase', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const modalStore = useUIModalStore()

    uiStore.navigatingIdeas = true
    modalStore.showIdeaModal = false
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:phase-empty'

    dataStore.phases['phase-empty'] = {
      id: 'phase-empty',
      name: 'Empty',
      from: 0,
      to: 1,
      parent: null,
      commitments: [],
      selectedIdeaIndex: undefined
    } as any

    await uiStore.handleIdeaNavigationKeys(keyEvent('o'), dataStore)

    expect(modalStore.showIdeaModal).toBe(true)
    expect(modalStore.ideaModalInsertPosition).toBe('after')
  })

  it('does not enter idea mode with i when selected column has no phases', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()

    uiStore.navigatingIdeas = false
    uiStore.activeColumn = 0
    dataStore.meta = { rootPhaseIds: [] }

    await uiStore.handleColumnNavigationKeys(keyEvent('i'), dataStore)

    expect(uiStore.navigatingIdeas).toBe(false)
  })

  it('enters idea mode with i when selected phase exists even if it has no ideas', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()

    uiStore.navigatingIdeas = false
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:phase-empty'
    dataStore.meta = { rootPhaseIds: ['phase-empty'] }
    dataStore.phases['phase-empty'] = {
      id: 'phase-empty',
      name: 'Empty',
      from: 0,
      to: 1,
      parent: null,
      childPhaseIds: [],
      commitments: [],
      selectedIdeaIndex: undefined
    } as any

    await uiStore.handleColumnNavigationKeys(keyEvent('i'), dataStore)

    expect(uiStore.navigatingIdeas).toBe(true)
  })

  it('deletes selected phase on second d press', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()

    projectStore.projectPath = '/tmp/project'
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:phase-1'
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

    await uiStore.handleColumnNavigationKeys(keyEvent('d'), dataStore)
    expect(uiStore.pendingDeletePhaseId).toBe('phase-1')

    await uiStore.handleColumnNavigationKeys(keyEvent('d'), dataStore)
    expect(deletePhaseSpy).toHaveBeenCalledWith('phase-1')
    expect(uiStore.pendingDeletePhaseId).toBeNull()
  })
})
