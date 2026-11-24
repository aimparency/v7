import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { linkedIdeaNodeId, useDataStore } from '../data'
import type { Idea } from 'shared'

vi.mock('../../trpc', () => ({ trpc: {} }))
vi.mock('../../utils/perf-log', () => ({ perfLog: vi.fn() }))
// The space's own server, talked to directly: set per test.
const server = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../../utils/remote-trpc', async (original) => ({
  ...await original<typeof import('../../utils/remote-trpc')>(),
  remoteTrpc: () => server.client
}))
const unreachable = { project: { getAccess: { query: async () => { throw new Error('no socket') } } } }

const REPO_ID = '11111111-1111-4111-8111-111111111111'
const HOST = 'https://hub.example.org/spaces/commons-hub'

const mkIdea = (partial: Partial<Idea> & { id: string }): Idea => ({
  text: partial.id, archived: false, tags: [], supportingConnections: [], supportedIdeas: [], committedIn: [],
  status: { state: 'open', comment: '', date: 0 }, intrinsicValue: 0, cost: 1, selfWeight: 0, duration: 1,
  costVariance: 0, valueVariance: 0, ...partial
} as Idea)

// The linked space as its server sends it: one top idea with one child.
const remote = [
  mkIdea({ id: '22222222-2222-4222-8222-222222222222', text: 'Garden', intrinsicValue: 1, supportingConnections: [{ ideaId: '33333333-3333-4333-8333-333333333333', weight: 1, relativePosition: [0, 0] }] as Idea['supportingConnections'] }),
  mkIdea({ id: '33333333-3333-4333-8333-333333333333', text: 'Compost', intrinsicValue: 1, supportedIdeas: ['22222222-2222-4222-8222-222222222222'] })
]

function storeWithLink() {
  const store = useDataStore()
  store.ideas = { 'idea-1': mkIdea({ id: 'idea-1', supportingRepos: [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }] }) }
  store.meta = { name: 'p', color: '#ffffff', linkedRepos: [{ repoId: REPO_ID, name: 'Commons Hub', host: HOST }] } as any
  store.calculatedValues = new Map([['idea-1', 0.5], [REPO_ID, 0.4]])
  return store
}

describe('a linked space opened in place', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
    server.client = unreachable
  })

  it('takes its ideas in like the open space\'s own, read-only for the viewer, and asks for a login there to change them', async () => {
    server.client = {
      project: {
        getAccess: { query: async () => ({ writable: false }) },
        loadIdeas: { query: async () => ({ ideas: remote, unreadable: [] }) },
        getMeta: { query: async () => ({ repoId: REPO_ID, name: 'Commons Hub', color: '#123456' }) },
        onUpdate: { subscribe: () => ({ unsubscribe: () => {} }) }
      }
    }
    const store = storeWithLink()

    await store.toggleLinkedSpace(REPO_ID)

    const garden = store.graphData.nodes.find(n => n.id === remote[0]!.id)!
    expect([garden.linked, garden.space]).toEqual([false, REPO_ID])
    expect(store.ideas[remote[1]!.id]?.text).toBe('Compost')
    expect(store.mayEditIdea(remote[0]!.id)).toBe(false)
    expect(store.mayEditIdea('idea-1')).toBe(store.access.writable)

    store.askToEditSpace(REPO_ID)
    const { useUIModalStore } = await import('../ui/modal-store')
    expect(useUIModalStore().connectServer).toEqual({ host: HOST, spaceName: 'Commons Hub' })

    await store.toggleLinkedSpace(REPO_ID) // closes it again: its ideas leave the store
    expect(store.ideas[remote[1]!.id]).toBeUndefined()
  })

  it('is read apart from its host when its server does not answer: its ideas hang read-only below its node, sharing out the inflow', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { data: { ideas: remote, unreadable: [] } } })))
    vi.stubGlobal('fetch', fetchMock)
    const store = storeWithLink()

    await store.toggleLinkedSpace(REPO_ID)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('https://hub.example.org/trpc/project.loadIdeas')

    const { nodes, links } = store.graphData
    const garden = nodes.find(n => n.id === linkedIdeaNodeId(REPO_ID, remote[0]!.id))!
    const compost = nodes.find(n => n.id === linkedIdeaNodeId(REPO_ID, remote[1]!.id))!
    expect([garden.linked, garden.host, garden.spawnNear]).toEqual([true, HOST, REPO_ID])
    // The inflow 0.4 is shared out by intrinsic value (half each), and the
    // garden's half flows on to the compost supporting it.
    expect(garden.value).toBeCloseTo(0.2)
    expect(compost.value).toBeCloseTo(0.4)
    // Open, the space has no node of its own: its outline and ideas take its place.
    expect(nodes.some(n => n.id === REPO_ID)).toBe(false)
    expect(links.some(l => l.target === REPO_ID || l.source === REPO_ID)).toBe(false)
    expect(links).toContainEqual(expect.objectContaining({ source: compost.id, target: garden.id }))
    // The one connection idea-1 ← space is drawn from each idea with intrinsic
    // value, each carrying its share; none from the space's node any more.
    const intoIdea = links.filter(link => link.target === 'idea-1')
    expect(intoIdea.map(link => [link.source, link.weight])).toEqual([[garden.id, 0.5], [compost.id, 0.5]])

    await store.toggleLinkedSpace(REPO_ID) // closes it again
    expect(store.graphData.nodes.some(n => n.linked)).toBe(false)
    expect(store.graphData.nodes.some(n => n.id === REPO_ID)).toBe(true)
  })

  it('keeps the node of a space that cannot be reached and says it is not available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const store = storeWithLink()

    await store.toggleLinkedSpace(REPO_ID)

    const repoNode = store.graphData.nodes.find(n => n.id === REPO_ID)!
    expect(repoNode.text).toBe('Commons Hub (not available)')
    expect(store.graphData.nodes.some(n => n.linked)).toBe(false)
  })
})
