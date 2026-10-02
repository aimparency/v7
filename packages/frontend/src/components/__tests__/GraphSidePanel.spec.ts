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
          supportedAims: [],
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

const makeAim = (id: string, text: string) => ({
  id,
  text,
  description: '',
  supportedAims: [] as string[],
  supportingConnections: [] as Array<{ ideaId: string, weight: number, relativePosition: [number, number], explanation?: string }>,
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
    dataStore.ideas = { a1: makeAim('a1', 'Idea 1') } as any
    graphStore.setGraphSelection('a1')
    const updateAim = vi.spyOn(dataStore, 'updateAim').mockResolvedValue()

    const wrapper = mount(GraphSidePanel, {
      global: { plugins: [pinia] }
    })
    const valueInput = wrapper.find('input[placeholder="e.g. 10k, 1500"]')
    await valueInput.setValue('2k')
    await valueInput.trigger('change')

    expect(updateAim).toHaveBeenCalledWith('/tmp/project', 'a1', {
      intrinsicValue: 2000,
      cost: 1,
      loopWeight: 1
    })
  })

  it('persists explanation to the originally edited connection when selection changes before blur', async () => {
    const graphStore = useGraphUIStore()
    const projectStore = useProjectStore()
    const dataStore = useDataStore()

    projectStore.projectPath = '/tmp/project'

    const parent1 = makeAim('p1', 'Parent 1')
    const child1 = makeAim('c1', 'Child 1')
    parent1.supportingConnections = [
      { ideaId: 'c1', weight: 1, relativePosition: [0, 0], explanation: 'old-1' }
    ]

    const parent2 = makeAim('p2', 'Parent 2')
    const child2 = makeAim('c2', 'Child 2')
    parent2.supportingConnections = [
      { ideaId: 'c2', weight: 1, relativePosition: [0, 0], explanation: 'old-2' }
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

    await wrapper.find('.explanation-view').trigger('click')

    const textarea = wrapper.find('textarea')
    await textarea.setValue('updated explanation')

    graphStore.selectLink('p2', 'c2')
    await textarea.trigger('blur')

    expect(trpc.idea.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        ideaId: 'p1',
        idea: expect.objectContaining({
          supportingConnections: expect.arrayContaining([
            expect.objectContaining({ ideaId: 'c1', explanation: 'updated explanation' })
          ])
        })
      })
    )

    const updatedParent1 = dataStore.ideas.p1
    const updatedParent2 = dataStore.ideas.p2
    if (!updatedParent1 || !updatedParent2) throw new Error('parents should exist in test setup')

    expect(updatedParent1.supportingConnections[0]?.explanation).toBe('updated explanation')
    expect(updatedParent2.supportingConnections[0]?.explanation).toBe('old-2')
  })
})
