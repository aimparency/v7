import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'

// Mock trpc
const mockTrpc = vi.hoisted(() => ({
  aim: {
    list: { query: vi.fn() },
    get: { query: vi.fn() },
    createFloatingAim: { mutate: vi.fn() },
    update: { mutate: vi.fn() },
    delete: { mutate: vi.fn() },
    commitToPhase: { mutate: vi.fn() },
    connectAims: { mutate: vi.fn() },
    removeFromPhase: { mutate: vi.fn() }
  },
  phase: {
    list: { query: vi.fn() },
    get: { query: vi.fn() },
    create: { mutate: vi.fn() },
    update: { mutate: vi.fn() }
  },
  project: {
    onUpdate: { subscribe: vi.fn() },
    getMeta: { query: vi.fn() },
    repair: { mutate: vi.fn() },
    checkConsistency: { query: vi.fn() },
    fixConsistency: { mutate: vi.fn() }
  }
}))

vi.mock('../trpc', () => ({
  trpc: mockTrpc
}))

describe('Multi-Client Sync', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('updates state correctly when a floating aim is committed to a phase by another client', async () => {
    const store = useDataStore()
    const uiStore = useUIStore()
    const projectPath = '/test/project'
    uiStore.projectPath = projectPath

    // 1. Initial State: 1 Floating Aim, 1 Phase
    const aimId = 'aim-1'
    const phaseId = 'phase-1'
    
    const initialAim = {
      id: aimId,
      text: 'Floating Aim',
      status: { state: 'open' },
      committedIn: [],
      supportedAims: [],
      supportingConnections: []
    }

    const initialPhase = {
      id: phaseId,
      name: 'Phase 1',
      from: 1000,
      to: 2000,
      commitments: []
    }

    // Mock initial load responses
    mockTrpc.aim.list.query.mockResolvedValue([initialAim])
    mockTrpc.phase.list.query.mockResolvedValue([initialPhase])
    mockTrpc.phase.get.query.mockImplementation(({phaseId: id}) => {
        if (id === phaseId) return Promise.resolve(initialPhase)
        return Promise.resolve(null)
    })
    mockTrpc.aim.get.query.mockImplementation(({aimId: id}) => {
        if (id === aimId) return Promise.resolve(initialAim)
        return Promise.resolve(null)
    })

    // Load project
    let subscriptionCallback: any
    mockTrpc.project.onUpdate.subscribe.mockImplementation((_, opts) => {
      subscriptionCallback = opts.onData
      return { unsubscribe: vi.fn() }
    })

    await store.loadProject(projectPath)

    expect(store.floatingAims.length).toBe(1)
    expect(store.floatingAims[0].id).toBe(aimId)
    expect(store.getAimsForPhase(phaseId).length).toBe(0)

    // 2. Simulate Remote Update: Phase updated (commitments added)
    // Server emits 'phase' change first (usually)
    const updatedPhase = { ...initialPhase, commitments: [aimId] }
    
    // Update mock for get
    mockTrpc.phase.get.query.mockResolvedValue(updatedPhase)

    // Trigger callback
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath })

    // Check state: Aim should be in phase list?
    // getAimsForPhase uses phase.commitments -> store.aims[id]
    // store.phases[phaseId] updated via replacePhase
    // store.aims[aimId] exists (from floating load)
    
    const phaseAims = store.getAimsForPhase(phaseId)
    expect(phaseAims.length).toBe(1)
    expect(phaseAims[0].id).toBe(aimId)

    // 3. Simulate Remote Update: Aim updated (committedIn added)
    const updatedAim = { ...initialAim, committedIn: [phaseId] }
    mockTrpc.aim.get.query.mockResolvedValue(updatedAim)

    // Trigger callback
    await subscriptionCallback({ type: 'aim', id: aimId, projectPath })

    // Check state: Aim should be removed from floating
    expect(store.floatingAimsIds).not.toContain(aimId)
    expect(store.floatingAims.length).toBe(0)
    
    // And still in phase
    expect(store.getAimsForPhase(phaseId).length).toBe(1)
  })

  it('updates state correctly when Aim update arrives before Phase update', async () => {
    const store = useDataStore()
    const uiStore = useUIStore()
    const projectPath = '/test/project'
    uiStore.projectPath = projectPath

    // Initial State
    const aimId = 'aim-2'
    const phaseId = 'phase-2'
    
    const initialAim = {
      id: aimId,
      text: 'Floating Aim 2',
      status: { state: 'open' },
      committedIn: [],
      supportedAims: [],
      supportingConnections: []
    }

    const initialPhase = {
      id: phaseId,
      name: 'Phase 2',
      from: 1000,
      to: 2000,
      commitments: []
    }

    mockTrpc.aim.list.query.mockResolvedValue([initialAim])
    mockTrpc.phase.list.query.mockResolvedValue([initialPhase])
    mockTrpc.phase.get.query.mockImplementation(({phaseId: id}) => {
        if (id === phaseId) return Promise.resolve(initialPhase)
        return Promise.resolve(null)
    })
    mockTrpc.aim.get.query.mockImplementation(({aimId: id}) => {
        if (id === aimId) return Promise.resolve(initialAim)
        return Promise.resolve(null)
    })

    let subscriptionCallback: any
    mockTrpc.project.onUpdate.subscribe.mockImplementation((_, opts) => {
      subscriptionCallback = opts.onData
      return { unsubscribe: vi.fn() }
    })

    await store.loadProject(projectPath)

    // 1. Simulate Remote Update: Aim updated (committedIn added)
    const updatedAim = { ...initialAim, committedIn: [phaseId] }
    mockTrpc.aim.get.query.mockResolvedValue(updatedAim)

    await subscriptionCallback({ type: 'aim', id: aimId, projectPath })

    // Check: Removed from floating
    expect(store.floatingAimsIds).not.toContain(aimId)
    
    // Check: Not yet in phase (phase not updated)
    expect(store.getAimsForPhase(phaseId).length).toBe(0)

    // 2. Simulate Remote Update: Phase updated (commitments added)
    const updatedPhase = { ...initialPhase, commitments: [aimId] }
    mockTrpc.phase.get.query.mockResolvedValue(updatedPhase)

    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath })

    // Check: Now in phase
    expect(store.getAimsForPhase(phaseId).length).toBe(1)
  })

  it('loads missing aims when a phase update is received via subscription', async () => {
    const store = useDataStore()
    const uiStore = useUIStore()
    const projectPath = '/test/project'
    uiStore.projectPath = projectPath

    const aimId = 'new-aim-3'
    const phaseId = 'phase-3'
    
    const initialPhase = {
      id: phaseId,
      name: 'Phase 3',
      from: 1000,
      to: 2000,
      commitments: []
    }

    const updatedPhase = { ...initialPhase, commitments: [aimId] }
    const newAim = { id: aimId, text: 'New Aim', status: { state: 'open' } }

    mockTrpc.phase.list.query.mockResolvedValue([initialPhase])
    mockTrpc.aim.list.query.mockResolvedValue([]) // No aims initially
    mockTrpc.phase.get.query.mockResolvedValue(updatedPhase)
    mockTrpc.aim.list.query.mockResolvedValueOnce([]) // for loadProject
    mockTrpc.aim.list.query.mockResolvedValueOnce([newAim]) // for loadAims call inside sub

    let subscriptionCallback: any
    mockTrpc.project.onUpdate.subscribe.mockImplementation((_, opts) => {
      subscriptionCallback = opts.onData
      return { unsubscribe: vi.fn() }
    })

    await store.loadProject(projectPath)

    // Trigger Phase update
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath })

    // Check: loadAims should have been called for the missing aim
    expect(mockTrpc.aim.list.query).toHaveBeenCalledWith(expect.objectContaining({
      ids: [aimId]
    }))

    // Check: Now in phase
    expect(store.getAimsForPhase(phaseId).length).toBe(1)
    expect(store.aims[aimId].text).toBe('New Aim')
  })
})
