import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'

// Use hoisted to make variable available inside vi.mock
const { mockTrpc } = vi.hoisted(() => {
  return {
    mockTrpc: {
      project: {
        repair: { mutate: vi.fn().mockResolvedValue({}) },
        getMeta: { query: vi.fn().mockResolvedValue({}) },
        checkConsistency: { query: vi.fn().mockResolvedValue({ valid: true, errors: [] }) },
        loadIdeas: { query: vi.fn().mockResolvedValue({ ideas: [], unreadable: [] }) },
        onUpdate: {
          subscribe: vi.fn((input, opts) => {
            subscriptionCallback = opts.onData
            return { unsubscribe: vi.fn() }
          })
        }
      },
      idea: {
        list: { query: vi.fn() },
        getMany: { query: vi.fn() },
        get: { query: vi.fn() },
        createFloatingIdea: { mutate: vi.fn() },
        update: { mutate: vi.fn() },
        delete: { mutate: vi.fn() },
        commitToPhase: { mutate: vi.fn() },
        connectIdeas: { mutate: vi.fn() },
        removeFromPhase: { mutate: vi.fn() }
      },
      phase: {
        list: { query: vi.fn() },
        get: { query: vi.fn() },
        create: { mutate: vi.fn() },
        update: { mutate: vi.fn() },
        reorder: { mutate: vi.fn().mockResolvedValue({ success: true }) },
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
    calculateIdeaValues: vi.fn(() => ({ 
        values: new Map(), costs: new Map(), doneCosts: new Map(), flowShares: new Map(), flowValues: new Map(), totalIntrinsic: 0 
    }))
  }
})

describe('Multi-Client Synchronization', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('updates state correctly when a floating idea is committed to a phase by another client', async () => {
    const store = useDataStore()
    const projectStore = useProjectStore()
    const projectPath = '/test/project'
    projectStore.projectPath = projectPath

    // 1. Initial State: 1 Floating Idea, 1 Phase
    const ideaId = 'idea-1'
    const phaseId = 'phase-1'
    
    const initialIdea = {
      id: ideaId,
      text: 'Idea 1',
      status: { state: 'open' },
      committedIn: [],
      supportedIdeas: [],
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
    mockTrpc.project.getMeta.query.mockResolvedValue({ rootPhaseIds: [phaseId] })
    mockTrpc.project.loadIdeas.query.mockResolvedValue({ ideas: [initialIdea], unreadable: [] })
    mockTrpc.phase.list.query.mockResolvedValue([initialPhase])
    mockTrpc.phase.get.query.mockImplementation(({phaseId: id}: any) => {
        if (id === phaseId) return Promise.resolve(initialPhase)
        return Promise.resolve(null)
    })
    mockTrpc.idea.get.query.mockImplementation(({ideaId: id}: any) => {
        if (id === ideaId) return Promise.resolve(initialIdea)
        return Promise.resolve(null)
    })

    await store.loadProject(projectPath)

    expect(store.floatingIdeas.length).toBe(1)
    expect(store.floatingIdeas[0]!.id).toBe(ideaId)
    expect(store.getIdeasForPhase(phaseId).length).toBe(0)

    // 2. Simulate Remote Update: Phase updated (commitments added)
    const updatedPhase = { ...initialPhase, commitments: [ideaId] }
    
    // Update mock for get (server sends updated phase)
    mockTrpc.phase.get.query.mockResolvedValue(updatedPhase)

    // Trigger callback
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath })

    // Check state: Idea should be in phase list?
    const phaseIdeas = store.getIdeasForPhase(phaseId)
    expect(phaseIdeas.length).toBe(1)
    expect(phaseIdeas[0]!.id).toBe(ideaId)

    // 3. Simulate Remote Update: Idea updated (committedIn added)
    const updatedIdea = { ...initialIdea, committedIn: [phaseId] }
    mockTrpc.idea.get.query.mockResolvedValue(updatedIdea)

    // Trigger callback
    await subscriptionCallback({ type: 'idea', id: ideaId, projectPath })

    // Check: Removed from floating
    expect(store.floatingIdeasIds).not.toContain(ideaId)
    expect(store.floatingIdeas.length).toBe(0)
    
    // And still in phase
    expect(store.getIdeasForPhase(phaseId).length).toBe(1)
  })

  it('applies pushed entities and deletions without refetching', async () => {
    const store = useDataStore()
    const projectStore = useProjectStore()
    const projectPath = '/test/project'
    projectStore.projectPath = projectPath

    const ideaId = 'new-idea-3'
    const phaseId = 'phase-3'
    const initialPhase = { id: phaseId, name: 'Phase 3', parent: null, childPhaseIds: [], commitments: [] }
    const newIdea = { id: ideaId, text: 'New Idea', status: { state: 'open' }, committedIn: [phaseId], supportingConnections: [], supportedIdeas: [] }

    mockTrpc.project.getMeta.query.mockResolvedValue({ rootPhaseIds: [phaseId] })
    mockTrpc.project.loadIdeas.query.mockResolvedValue({ ideas: [], unreadable: [] })
    mockTrpc.phase.list.query.mockResolvedValue([initialPhase])

    await store.loadProject(projectPath)

    await subscriptionCallback({ type: 'idea', id: ideaId, projectPath, entity: newIdea })
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath, entity: { ...initialPhase, commitments: [ideaId] } })
    await subscriptionCallback({ type: 'project', id: 'meta', projectPath, entity: { rootPhaseIds: [phaseId], name: 'Renamed' } })

    expect(store.getIdeasForPhase(phaseId).map((idea) => idea.id)).toEqual([ideaId])
    expect(store.meta.name).toBe('Renamed')
    expect(mockTrpc.idea.get.query).not.toHaveBeenCalled()
    expect(mockTrpc.phase.get.query).not.toHaveBeenCalled()
    expect(mockTrpc.project.getMeta.query).toHaveBeenCalledTimes(1)

    await subscriptionCallback({ type: 'idea', id: ideaId, projectPath, deleted: true })
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath, deleted: true })

    expect(store.ideas[ideaId]).toBeUndefined()
    expect(store.phases[phaseId]).toBeUndefined()
  })

  it('does not let an older mutation response overwrite a newer subscription refresh', async () => {
    const store = useDataStore()
    const projectPath = '/test/project'
    const ideaId = 'idea-race'
    const initialIdea = {
      id: ideaId,
      text: 'Initial',
      status: { state: 'open' },
      committedIn: [],
      supportedIdeas: [],
      supportingConnections: []
    }
    store.replaceIdea(ideaId, initialIdea as any)
    store.subscribeToUpdates(projectPath)

    let resolveMutation!: (idea: any) => void
    const mutationResponse = new Promise(resolve => { resolveMutation = resolve })
    mockTrpc.idea.update.mutate.mockReturnValue(mutationResponse)
    mockTrpc.idea.get.query.mockResolvedValue({ ...initialIdea, text: 'Newest server state' })

    const mutation = store.updateIdea(projectPath, ideaId, { text: 'Mutation response' } as any)
    await subscriptionCallback({ type: 'idea', id: ideaId, projectPath })
    resolveMutation({ ...initialIdea, text: 'Mutation response' })
    await mutation

    expect(store.ideas[ideaId]!.text).toBe('Newest server state')
  })

  it('does not let an older phase mutation response overwrite a newer subscription refresh', async () => {
    const store = useDataStore()
    const projectPath = '/test/project'
    const phaseId = 'phase-race'
    const initialPhase = {
      id: phaseId,
      name: 'Initial',
      parent: 'old-parent',
      commitments: [],
      childPhaseIds: []
    }
    store.replacePhase(phaseId, initialPhase as any)
    store.subscribeToUpdates(projectPath)

    let resolveMutation!: (phase: any) => void
    const mutationResponse = new Promise(resolve => { resolveMutation = resolve })
    mockTrpc.phase.update.mutate.mockReturnValue(mutationResponse)
    mockTrpc.phase.get.query.mockResolvedValue({
      ...initialPhase,
      name: 'Newest server state',
      parent: 'new-parent'
    })

    const mutation = store.movePhase(projectPath, phaseId, 'new-parent', 0)
    await subscriptionCallback({ type: 'phase', id: phaseId, projectPath })
    resolveMutation({ ...initialPhase, name: 'Mutation response', parent: 'new-parent' })
    await mutation

    expect(store.phases[phaseId]!.name).toBe('Newest server state')
  })

  it('applies subscription entity payloads without query round-trips', async () => {
    const store = useDataStore()
    const projectPath = '/test/project'
    const idea = {
      id: 'payload-idea',
      text: 'Payload idea',
      status: { state: 'open' },
      committedIn: [],
      supportedIdeas: [],
      supportingConnections: []
    }
    const phase = {
      id: 'payload-phase',
      name: 'Payload phase',
      parent: null,
      commitments: [],
      childPhaseIds: []
    }
    store.subscribeToUpdates(projectPath)

    await subscriptionCallback({ type: 'idea', id: idea.id, projectPath, entity: idea })
    await subscriptionCallback({ type: 'phase', id: phase.id, projectPath, entity: phase })

    expect(store.ideas[idea.id]!.text).toBe('Payload idea')
    expect(store.phases[phase.id]!.name).toBe('Payload phase')
    expect(mockTrpc.idea.get.query).not.toHaveBeenCalled()
    expect(mockTrpc.phase.get.query).not.toHaveBeenCalled()
  })
})
