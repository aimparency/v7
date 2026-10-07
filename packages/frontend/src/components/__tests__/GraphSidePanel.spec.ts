import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GraphSidePanel from '../GraphSidePanel.vue'
import { useGraphUIStore } from '../../stores/ui/graph-store'
import { useDataStore } from '../../stores/data'
import { useProjectStore } from '../../stores/project-store'

vi.mock('../../trpc', () => ({
  trpc: {
    idea: {
      update: {
        // The real endpoint returns a complete idea, not the sparse patch.
        mutate: vi.fn().mockImplementation(async ({ ideaId, idea }: any) => ({
          id: ideaId,
          text: 'Updated idea',
          status: { state: 'open' },
          supportedIdeas: [],
          supportingConnections: [],
          committedIn: [],
          intrinsicValue: 0,
          cost: 1,
          loopWeight: 1,
          ...idea,
        }))
      }
    }
  }
}))

import { trpc } from '../../trpc'

const makeIdea = (id: string, text: string) => ({
  id,
  text,
  description: '',
  supportedIdeas: [] as string[],
  supportingConnections: [] as Array<{ ideaId: string, weight: number, relativePosition: [number, number], hypothesis?: string }>,
  status: { state: 'open' as const },
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 1,
  incoming: [] as string[],
  committedIn: [] as string[]
})

describe('GraphSidePanel', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
  })

  it('routes quick idea metric edits through the data store update action', async () => {
    const graphStore = useGraphUIStore()
    const projectStore = useProjectStore()
    const dataStore = useDataStore()
    projectStore.projectPath = '/tmp/project'
    dataStore.ideas = { a1: makeIdea('a1', 'Idea 1') } as any
    graphStore.setGraphSelection('a1')
    const updateIdea = vi.spyOn(dataStore, 'updateIdea').mockResolvedValue()

    const wrapper = mount(GraphSidePanel, {
      global: { plugins: [pinia] }
    })
    const valueInput = wrapper.find('input[placeholder="e.g. 10k, 1500"]')
    await valueInput.setValue('2k')
    await valueInput.trigger('change')

    expect(updateIdea).toHaveBeenCalledWith('/tmp/project', 'a1', {
      intrinsicValue: 2000,
      cost: 1,
      loopWeight: 1
    })
  })

  it('persists hypothesis to the originally edited connection when selection changes before blur', async () => {
    const graphStore = useGraphUIStore()
    const projectStore = useProjectStore()
    const dataStore = useDataStore()

    projectStore.projectPath = '/tmp/project'

    const parent1 = makeIdea('p1', 'Parent 1')
    const child1 = makeIdea('c1', 'Child 1')
    parent1.supportingConnections = [
      { ideaId: 'c1', weight: 1, relativePosition: [0, 0], hypothesis: 'old-1' }
    ]

    const parent2 = makeIdea('p2', 'Parent 2')
    const child2 = makeIdea('c2', 'Child 2')
    parent2.supportingConnections = [
      { ideaId: 'c2', weight: 1, relativePosition: [0, 0], hypothesis: 'old-2' }
    ]

    dataStore.ideas = {
      p1: parent1,
      c1: child1,
      p2: parent2,
      c2: child2
    } as any

    graphStore.selectLink('p1', 'c1')

    const wrapper = mount(GraphSidePanel, {
      global: {
        plugins: [pinia]
      }
    })

    await wrapper.find('.hypothesis-view').trigger('click')

    const textarea = wrapper.find('textarea')
    await textarea.setValue('updated hypothesis')

    graphStore.selectLink('p2', 'c2')
    await textarea.trigger('blur')

    expect(trpc.idea.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        ideaId: 'p1',
        idea: expect.objectContaining({
          supportingConnections: expect.arrayContaining([
            expect.objectContaining({ ideaId: 'c1', hypothesis: 'updated hypothesis' })
          ])
        })
      })
    )

    const updatedParent1 = dataStore.ideas.p1
    const updatedParent2 = dataStore.ideas.p2
    if (!updatedParent1 || !updatedParent2) throw new Error('parents should exist in test setup')

    expect(updatedParent1.supportingConnections[0]?.hypothesis).toBe('updated hypothesis')
    expect(updatedParent2.supportingConnections[0]?.hypothesis).toBe('old-2')
  })
})
