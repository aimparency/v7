import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDataStore } from '../data'
import type { Idea } from 'shared'

vi.mock('../../trpc', () => ({ trpc: {} }))
vi.mock('../../utils/db', () => ({ loadAllIdeasCache: vi.fn(), saveIdeas: vi.fn() }))
vi.mock('../../utils/perf-log', () => ({ perfLog: vi.fn() }))

function mkIdea(id: string, childIds: string[] = []): Idea {
  return {
    id,
    text: id,
    reflections: [],
    archived: false,
    tags: [],
    supportingConnections: childIds.map((ideaId) => ({ ideaId, weight: 1, relativePosition: [1, 1] })),
    supportedIdeas: [],
    committedIn: [],
    status: { state: 'open', comment: '', date: 0 },
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0
  } as Idea
}

describe('graphData unreadable-idea nodes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('draws an unreadable idea as a red "!" node and keeps its links in both directions', () => {
    const store = useDataStore()
    store.ideas = { parent: mkIdea('parent', ['broken']), grandchild: mkIdea('grandchild') }
    store.unreadableIdeas = [{
      id: 'broken',
      file: 'ideas/broken.json',
      error: 'cost: Number must be greater than 0',
      text: 'Graph view',
      supportingIdeaIds: ['grandchild', 'gone']
    }]

    const { nodes, links } = store.graphData

    const broken = nodes.find((node) => node.id === 'broken')!
    expect(broken.text).toBe('! Graph view')
    expect(broken.unreadable).toBe('cost: Number must be greater than 0')
    expect(broken.color).toBe('#f85149')
    expect(nodes.find((node) => node.id === 'parent')!.unreadable).toBeUndefined()

    // parent → broken (from the readable parent) and broken → grandchild (from
    // the raw file); a link to an idea that exists nowhere is dropped.
    expect(links.map((link) => `${link.target}<-${link.source}`).sort()).toEqual(['broken<-grandchild', 'parent<-broken'])
  })
})
