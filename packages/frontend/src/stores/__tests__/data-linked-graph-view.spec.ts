import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { linkedIdeaNodeId, useDataStore } from '../data'
import type { Idea } from 'shared'

vi.mock('../../trpc', () => ({ trpc: {} }))
vi.mock('../../utils/perf-log', () => ({ perfLog: vi.fn() }))

const REPO_ID = '11111111-1111-4111-8111-111111111111'
const HOST = 'https://hub.example.org/spaces/commons-hub'

const mkIdea = (partial: Partial<Idea> & { id: string }): Idea => ({
  text: partial.id, archived: false, tags: [], supportingConnections: [], supportedIdeas: [], committedIn: [],
  status: { state: 'open', comment: '', date: 0 }, intrinsicValue: 0, cost: 1, selfWeight: 0, duration: 1,
  costVariance: 0, valueVariance: 0, ...partial
} as Idea)

// The linked graph as its server sends it: one top idea with one child.
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

describe('a linked graph opened in place', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('loads the graph from its host and hangs its ideas, read-only, below its node with the inflow shared out', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { data: { ideas: remote, unreadable: [] } } })))
    vi.stubGlobal('fetch', fetchMock)
    const store = storeWithLink()

    await store.toggleLinkedGraph(REPO_ID)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('https://hub.example.org/trpc/project.loadIdeas')

    const { nodes, links } = store.graphData
    const garden = nodes.find(n => n.id === linkedIdeaNodeId(REPO_ID, remote[0]!.id))!
    const compost = nodes.find(n => n.id === linkedIdeaNodeId(REPO_ID, remote[1]!.id))!
    expect([garden.linked, garden.host, garden.spawnNear]).toEqual([true, HOST, REPO_ID])
    // The inflow 0.4 is shared out by intrinsic value (half each), and the
    // garden's half flows on to the compost supporting it.
    expect(garden.value).toBeCloseTo(0.2)
    expect(compost.value).toBeCloseTo(0.4)
    expect(links).toContainEqual(expect.objectContaining({ source: garden.id, target: REPO_ID }))
    expect(links).toContainEqual(expect.objectContaining({ source: compost.id, target: garden.id }))
    // The one connection idea-1 ← graph is drawn from each idea with intrinsic
    // value, each carrying its share; none from the graph's node any more.
    const intoIdea = links.filter(link => link.target === 'idea-1')
    expect(intoIdea.map(link => [link.source, link.weight])).toEqual([[garden.id, 0.5], [compost.id, 0.5]])

    await store.toggleLinkedGraph(REPO_ID) // closes it again
    expect(store.graphData.nodes.some(n => n.linked)).toBe(false)
  })

  it('keeps the node of a graph that cannot be reached and says it is not available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const store = storeWithLink()

    await store.toggleLinkedGraph(REPO_ID)

    const repoNode = store.graphData.nodes.find(n => n.id === REPO_ID)!
    expect(repoNode.text).toBe('Commons Hub (not available)')
    expect(store.graphData.nodes.some(n => n.linked)).toBe(false)
  })
})
