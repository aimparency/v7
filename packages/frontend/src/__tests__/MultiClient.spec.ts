import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'

// Use hoisted to make variable available inside vi.mock
const { mockTrpc } = vi.hoisted(() => {
  return {
    mockTrpc: {
      project: {
        repair: { mutate: vi.fn().mockResolvedValue({}) },
        getMeta: { query: vi.fn().mockResolvedValue({}) },
        checkConsistency: { query: vi.fn().mockResolvedValue({ valid: true, errors: [] }) },
        onUpdate: {
          subscribe: vi.fn((input, opts) => {
            subscriptionCallback = opts.onData
            return { unsubscribe: vi.fn() }
          })
        }
      },
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
      }
    }
  }
})

let subscriptionCallback: any

vi.mock('../trpc', () => ({
  trpc: mockTrpc
}))

// Mock value calculation (shared)
vi.mock('shared', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    calculateAimValues: vi.fn(() => ({ 
        values: new Map(), costs: new Map(), doneCosts: new Map(), flowShares: new Map(), flowValues: new Map(), totalIntrinsic: 0 
    }))
  }
})

describe('Multi-Client Synchronization', () => {
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
      text: 'Aim 1',
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
    mockTrpc.phase.get.query.mockImplementation(({phaseId: id}: any) => {
        if (id === phaseId) return Promise.resolve(initialPhase)
        return Promise.resolve(null)
    })
    mockTrpc.aim.get.query.mockImplementation(({aimId: id}: any) => {
        if (id === aimId) return Promise.resolve(initialAim)
        return Promise.resolve(null)
    })

    await store.loadProject(projectPath)

    expect(store.floatingAims.length).toBe(1)
    expect(store.floatingAims[0]!.id).toBe(aimId)
    expect(store.getAimsForPhase(phaseId).length).toBe(0)

    // 2. Simulate Remote Update: Phase updated (commitments added)
    const updatedPhase = { ...initialPhase, commitments: [aimId] }
    
    // Update mock for get (server sends updated phase)
    mockTrpc.phase.get.query.mockResolvedValue(updatedPhase)

    // Trigger callback
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath })

    // Check state: Aim should be in phase list?
    const phaseAims = store.getAimsForPhase(phaseId)
    expect(phaseAims.length).toBe(1)
    expect(phaseAims[0]!.id).toBe(aimId)

    // 3. Simulate Remote Update: Aim updated (committedIn added)
    const updatedAim = { ...initialAim, committedIn: [phaseId] }
    mockTrpc.aim.get.query.mockResolvedValue(updatedAim)

    // Trigger callback
    await subscriptionCallback({ type: 'aim', id: aimId, projectPath })

    // Check: Removed from floating
    expect(store.floatingAimsIds).not.toContain(aimId)
    expect(store.floatingAims.length).toBe(0)
    
    // And still in phase
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
    const newAim = { id: aimId, text: 'New Aim', status: { state: 'open' }, committedIn: [phaseId], supportingConnections: [], supportedAims: [] }

    mockTrpc.phase.list.query.mockResolvedValue([initialPhase])
    mockTrpc.aim.list.query.mockResolvedValue([]) // No aims initially
    mockTrpc.phase.get.query.mockResolvedValue(updatedPhase)
    mockTrpc.aim.get.query.mockResolvedValue(newAim)
    
    // We need to ensure loadAims triggers a list query
    // loadAims calls trpc.aim.list.query with ids
    mockTrpc.aim.list.query.mockImplementation((args: any) => {
        if (args.ids && args.ids.includes(aimId)) return Promise.resolve([newAim])
        return Promise.resolve([])
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
    // Verify sync
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(store.aims[aimId]!.text).toBe('New Aim')
  })
})