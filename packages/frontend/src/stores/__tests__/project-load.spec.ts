import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { overallProgress, useProjectLoadStore, type LoadStep } from '../project-load'
import { useDataStore } from '../data'
import { useProjectStore } from '../project-store'
import { useUIStore } from '../ui'
import { useGraphUIStore } from '../ui/graph-store'

const { mockTrpc, updates } = vi.hoisted(() => {
  const updates: { deliver: (event: unknown) => Promise<void> } = { deliver: async () => {} }
  const subscription = () => ({ unsubscribe: vi.fn() })
  return {
    updates,
    mockTrpc: {
      activity: { onAccess: { subscribe: vi.fn(subscription) }, snapshot: { query: vi.fn().mockResolvedValue({ ideas: {}, seq: 0 }) } },
      phase: { list: { query: vi.fn() } },
      project: {
        getMeta: { query: vi.fn() },
        getAccess: { query: vi.fn() },
        loadIdeas: { query: vi.fn() },
        openGitUrl: { mutate: vi.fn() },
        onLoadProgress: { subscribe: vi.fn(subscription) },
        onUpdate: {
          subscribe: vi.fn((_input: unknown, handlers: { onData: (event: unknown) => Promise<void> }) => {
            updates.deliver = handlers.onData
            return { unsubscribe: vi.fn() }
          })
        }
      },
      graphHealth: { fixConsistency: { mutate: vi.fn().mockResolvedValue({ fixes: [] }) } }
    }
  }
})

vi.mock('../../trpc', () => ({ trpc: mockTrpc }))
vi.mock('../../utils/perf-log', () => ({ perfLog: vi.fn(), hasQueryFlag: () => false }))
vi.mock('../../utils/runtime-config', () => ({ getRuntimeConfig: () => ({ hosted: false, project: '' }) }))

const idea = (id: string, text = id) => ({
  id, text, archived: false, tags: [], supportingConnections: [], supportedIdeas: [], committedIn: [],
  status: { state: 'open', comment: '', date: 0 }, intrinsicValue: 0, cost: 1, selfWeight: 0, duration: 1, costVariance: 0, valueVariance: 0
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function serveProject(ideas: unknown[] = [idea('new-idea')]) {
  mockTrpc.project.getMeta.query.mockResolvedValue({ rootPhaseIds: [] })
  mockTrpc.project.getAccess.query.mockResolvedValue({ writable: true, reason: null, user: null, role: 'admin' })
  mockTrpc.phase.list.query.mockResolvedValue([])
  mockTrpc.project.loadIdeas.query.mockResolvedValue({ ideas, unreadable: [] })
}

// Runs until the load waits for a view; lets its paint yields pass.
async function untilViewStep(load: ReturnType<typeof useProjectLoadStore>) {
  await vi.waitFor(() => expect(load.isWaitingForView).toBe(true))
}

describe('overallProgress', () => {
  const steps: LoadStep[] = ['open', 'read', 'calculate', 'restore', 'view']

  it('only ever moves forward through a load', () => {
    let previous = -1
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      for (const fraction of [0, 0.5, 1]) {
        const progress = overallProgress(steps, stepIndex, fraction)
        expect(progress).toBeGreaterThanOrEqual(previous)
        previous = progress
      }
    }
    expect(previous).toBe(1)
  })

  it('starts at zero and weighs the clone in when there is one', () => {
    expect(overallProgress(steps, 0, 0)).toBe(0)
    expect(overallProgress(['clone', ...steps], 1, 0)).toBeCloseTo(40 / 140)
  })
})

describe('project load', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    serveProject()
  })

  it('shows the screen at once and mounts no view until UI state is restored', async () => {
    const load = useProjectLoadStore()
    void load.open('/p/one')
    expect(load.status).toBe('loading')
    expect(load.viewsMayMount).toBe(false)

    await untilViewStep(load)
    expect(load.viewsMayMount).toBe(true)
    expect(useDataStore().ideas['new-idea']).toBeDefined()
    expect(load.status).toBe('loading')
    expect(useUIStore().isRestoringUIState).toBe(true)
  })

  it('leaves the screen only when the view reports ready', async () => {
    const load = useProjectLoadStore()
    const opened = load.open('/p/one')
    await untilViewStep(load)
    load.viewIsReady()
    await opened
    expect(load.status).toBe('idle')
    expect(useUIStore().isRestoringUIState).toBe(false)
    expect(useProjectStore().projectHistory.map((entry) => entry.path)).toContain('/p/one')
  })

  it('chooses the saved view before any view can mount', async () => {
    localStorage.setItem('aimparency-ui-state:/p/one', JSON.stringify({ currentView: 'graph' }))
    const load = useProjectLoadStore()
    const seen: string[] = []
    const projectStore = useProjectStore()
    void load.open('/p/one')
    await vi.waitFor(() => {
      if (load.viewsMayMount) seen.push(projectStore.currentView)
      expect(load.viewsMayMount).toBe(true)
    })
    expect(seen.every((view) => view === 'graph')).toBe(true)
    expect(load.stepLabel).toBe('Preparing the graph')
  })

  it('clears the previous project when a load starts', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const graphStore = useGraphUIStore()
    dataStore.ideas = { old: idea('old') } as never
    dataStore.floatingIdeasIds = ['old']
    dataStore.phases = { oldPhase: { id: 'oldPhase' } } as never
    dataStore.meta = { name: 'old' }
    dataStore.consistencyErrors = ['old']
    dataStore.calculatedValues = new Map([['old', 1]])
    uiStore.multiSelectedIdeaIds = ['old']
    uiStore.currentPhaseIdByLevel = { 0: 'oldPhase' }
    uiStore.phaseIdeaUIStatesByPhaseId = { oldPhase: {} }
    graphStore.phaseFilter = { phaseId: 'oldPhase', phaseName: 'old', visibleIds: [], loadableIds: [] }

    const pending = deferred<{ rootPhaseIds: string[] }>()
    mockTrpc.project.getMeta.query.mockReturnValue(pending.promise)
    void useProjectLoadStore().open('/p/two')
    await vi.waitFor(() => expect(mockTrpc.project.getMeta.query).toHaveBeenCalled())

    expect(dataStore.ideas).toEqual({})
    expect(dataStore.floatingIdeasIds).toEqual([])
    expect(dataStore.phases).toEqual({})
    expect(dataStore.meta).toBeNull()
    expect(dataStore.consistencyErrors).toEqual([])
    expect(dataStore.calculatedValues.size).toBe(0)
    expect(uiStore.multiSelectedIdeaIds).toEqual([])
    expect(uiStore.currentPhaseIdByLevel).toEqual({})
    expect(uiStore.phaseIdeaUIStatesByPhaseId).toEqual({})
    expect(graphStore.phaseFilter).toBeNull()
  })

  it('ignores the answers of a load another one took over from', async () => {
    const slowIdeas = deferred<{ ideas: unknown[], unreadable: unknown[] }>()
    mockTrpc.project.loadIdeas.query.mockReturnValueOnce(slowIdeas.promise)
    const load = useProjectLoadStore()
    void load.open('/p/slow')
    await vi.waitFor(() => expect(mockTrpc.project.loadIdeas.query).toHaveBeenCalled())

    mockTrpc.project.loadIdeas.query.mockResolvedValue({ ideas: [idea('second-idea')], unreadable: [] })
    void load.open('/p/second')
    await untilViewStep(load)

    slowIdeas.resolve({ ideas: [idea('slow-idea')], unreadable: [] })
    await flushPromises()
    expect(Object.keys(useDataStore().ideas)).toEqual(['second-idea'])
    expect(useProjectStore().projectPath).toBe('/p/second')
  })

  it('cancel returns to the selection and applies nothing that arrives later', async () => {
    const slowIdeas = deferred<{ ideas: unknown[], unreadable: unknown[] }>()
    mockTrpc.project.loadIdeas.query.mockReturnValue(slowIdeas.promise)
    const load = useProjectLoadStore()
    void load.open('/p/one')
    await vi.waitFor(() => expect(mockTrpc.project.loadIdeas.query).toHaveBeenCalled())

    load.cancel()
    expect(load.status).toBe('idle')
    expect(load.viewsMayMount).toBe(true)
    expect(useProjectStore().projectPath).toBe('')

    slowIdeas.resolve({ ideas: [idea('late')], unreadable: [] })
    await flushPromises()
    expect(useDataStore().ideas).toEqual({})
  })

  it('replays what changed during the load on top of its answers', async () => {
    const slowIdeas = deferred<{ ideas: unknown[], unreadable: unknown[] }>()
    mockTrpc.project.loadIdeas.query.mockReturnValue(slowIdeas.promise)
    const load = useProjectLoadStore()
    void load.open('/p/one')
    await vi.waitFor(() => expect(mockTrpc.project.loadIdeas.query).toHaveBeenCalled())

    await updates.deliver({ type: 'idea', id: 'a', projectPath: '/p/one', entity: idea('a', 'edited during load') })
    expect(useDataStore().ideas).toEqual({})

    slowIdeas.resolve({ ideas: [idea('a', 'as read from disk')], unreadable: [] })
    await untilViewStep(load)
    expect(useDataStore().ideas['a']!.text).toBe('edited during load')
  })

  it('a failed load shows the error and keeps nothing of the old project', async () => {
    const dataStore = useDataStore()
    dataStore.ideas = { old: idea('old') } as never
    mockTrpc.project.getMeta.query.mockRejectedValue(new Error('no such project'))
    const load = useProjectLoadStore()
    await load.open('/p/bad')

    expect(load.status).toBe('failed')
    expect(load.error).toBe('no such project')
    expect(load.viewsMayMount).toBe(false)
    expect(dataStore.ideas).toEqual({})

    serveProject()
    load.retry()
    await untilViewStep(load)
    expect(load.error).toBe('')
    expect(dataStore.ideas['new-idea']).toBeDefined()
  })

  it('reports idea reading progress to the detail bar', async () => {
    const slowIdeas = deferred<{ ideas: unknown[], unreadable: unknown[] }>()
    mockTrpc.project.loadIdeas.query.mockReturnValue(slowIdeas.promise)
    const load = useProjectLoadStore()
    void load.open('/p/one')
    await vi.waitFor(() => expect(mockTrpc.project.onLoadProgress.subscribe).toHaveBeenCalled())
    await vi.waitFor(() => expect(mockTrpc.project.loadIdeas.query).toHaveBeenCalled())

    const call = mockTrpc.project.onLoadProgress.subscribe.mock.calls[0] as unknown as [unknown, { onData: (progress: { done: number, total: number }) => void }]
    const handlers = call[1]
    handlers.onData({ done: 30, total: 120 })
    expect(load.detail).toEqual({ done: 30, total: 120 })
    expect(load.detailFraction).toBe(0.25)
    expect(load.detailLabel).toBe('Reading ideas')
  })

  it('clones a Git URL first and keeps its address', async () => {
    mockTrpc.project.openGitUrl.mutate.mockResolvedValue({ projectPath: '/cache/repo' })
    const load = useProjectLoadStore()
    void load.open('https://github.com/owner/repo')
    expect(load.steps[0]).toBe('clone')
    expect(load.stepLabel).toBe('Cloning repository')

    await untilViewStep(load)
    expect(useProjectStore().projectPath).toBe('/cache/repo')
    expect(new URLSearchParams(window.location.search).get('repo')).toBe('https://github.com/owner/repo')
  })

  it('a consistency fix reloads the data without touching the UI state', async () => {
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/p/one'
    projectStore.currentView = 'graph'
    uiStore.activeColumn = 3
    await useDataStore().fixConsistency('/p/one')
    expect(uiStore.activeColumn).toBe(3)
    expect(projectStore.currentView).toBe('graph')
    expect(useDataStore().ideas['new-idea']).toBeDefined()
  })

  it('does not wait for a view when the content area is hidden', async () => {
    useProjectStore().terminalFullscreen = true
    const load = useProjectLoadStore()
    await load.open('/p/one')
    expect(load.status).toBe('idle')
  })
})
