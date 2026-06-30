import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '../data'
import type { Aim } from 'shared'

// data.ts pulls in browser-only deps at module load; stub them — graphData is a
// pure getter over store state and needs none of them.
vi.mock('../../trpc', () => ({ trpc: {} }))
vi.mock('../../utils/db', () => ({ loadAllAimsCache: vi.fn(), saveAims: vi.fn() }))
vi.mock('../../utils/perf-log', () => ({ perfLog: vi.fn() }))

const REPO_ID = '11111111-1111-4111-8111-111111111111'

function mkAim(partial: Partial<Aim> & { id: string }): Aim {
  return {
    text: partial.id,
    reflections: [],
    archived: false,
    tags: [],
    supportingConnections: [],
    supportedAims: [],
    committedIn: [],
    status: { state: 'open', comment: '', date: 0 },
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0,
    ...partial
  } as Aim
}

describe('graphData repo-node injection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('emits one black-box repo node + a repo→aim link for a supportingRepos edge', () => {
    const store = useDataStore()

    const aim = mkAim({ id: 'aim-1', supportedAims: [], supportingRepos: [{ repoId: REPO_ID, weight: 2, relativePosition: [0, 0] }] })
    store.aims = { 'aim-1': aim }
    store.meta = { name: 'p', color: '#ffffff', linkedRepos: [{ repoId: REPO_ID, name: 'Cool Lib' }] } as any
    // Value engine output (as recalculateValues would set it): the repo sink
    // holds exported flow; the parent→repo flow edge is keyed `${aim}->${repo}`.
    store.calculatedValues = new Map([['aim-1', 0.5], [REPO_ID, 0.5]])
    store.flowShares = new Map([[`aim-1->${REPO_ID}`, 1]])
    store.flowValues = new Map([[`aim-1->${REPO_ID}`, 0.5]])

    const { nodes, links } = store.graphData

    const repoNode = nodes.find(n => n.id === REPO_ID)
    expect(repoNode).toBeDefined()
    expect(repoNode!.isRepo).toBe(true)
    expect(repoNode!.text).toBe('Cool Lib') // labeled by the registry name
    expect(repoNode!.color).toBe('#9e9e9e') // neutral grey black box
    expect(repoNode!.value).toBe(0.5)       // sized by the exported flow it sinks

    // The local aim node stays a normal (non-repo) node.
    expect(nodes.find(n => n.id === 'aim-1')!.isRepo).toBe(false)

    // Edge direction mirrors supportingConnections: source=supporter(repo),
    // target=supported(local aim), carrying the repo edge's weight + flow.
    const repoLink = links.find(l => l.source === REPO_ID)
    expect(repoLink).toBeDefined()
    expect(repoLink!.target).toBe('aim-1')
    expect(repoLink!.weight).toBe(2)
    expect(repoLink!.flowValue).toBe(0.5)
  })

  it('emits a single repo node when two aims link the same repo', () => {
    const store = useDataStore()
    store.aims = {
      'a': mkAim({ id: 'a', supportingRepos: [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }] }),
      'b': mkAim({ id: 'b', supportingRepos: [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }] })
    }
    store.meta = { name: 'p', color: '#ffffff', linkedRepos: [{ repoId: REPO_ID, name: 'Shared' }] } as any
    store.calculatedValues = new Map()
    store.flowShares = new Map()
    store.flowValues = new Map()

    const { nodes, links } = store.graphData
    expect(nodes.filter(n => n.id === REPO_ID)).toHaveLength(1)        // one node per repo
    expect(links.filter(l => l.source === REPO_ID)).toHaveLength(2)    // but an edge from each aim
  })

  it('falls back to a short-id label when the repo is absent from the registry', () => {
    const store = useDataStore()
    store.aims = { 'a': mkAim({ id: 'a', supportingRepos: [{ repoId: REPO_ID, weight: 1, relativePosition: [0, 0] }] }) }
    store.meta = { name: 'p', color: '#ffffff' } as any // no linkedRepos
    store.calculatedValues = new Map()
    store.flowShares = new Map()
    store.flowValues = new Map()

    const repoNode = store.graphData.nodes.find(n => n.id === REPO_ID)
    expect(repoNode!.text).toBe(`repo:${REPO_ID.slice(0, 8)}`)
  })
})
