import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GraphSidePanel from '../GraphSidePanel.vue'
import { useUIStore } from '../../stores/ui'
import { useDataStore } from '../../stores/data'
import { useUIProjectStore } from '../../stores/project-store'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      update: {
        mutate: vi.fn().mockResolvedValue({})
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
  supportingConnections: [] as Array<{ aimId: string, weight: number, relativePosition: [number, number], explanation?: string }>,
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

  it('persists explanation to the originally edited connection when selection changes before blur', async () => {
    const uiStore = useUIStore()
    const projectStore = useUIProjectStore()
    const dataStore = useDataStore()

    projectStore.projectPath = '/tmp/project'

    const parent1 = makeAim('p1', 'Parent 1')
    const child1 = makeAim('c1', 'Child 1')
    parent1.supportingConnections = [
      { aimId: 'c1', weight: 1, relativePosition: [0, 0], explanation: 'old-1' }
    ]

    const parent2 = makeAim('p2', 'Parent 2')
    const child2 = makeAim('c2', 'Child 2')
    parent2.supportingConnections = [
      { aimId: 'c2', weight: 1, relativePosition: [0, 0], explanation: 'old-2' }
    ]

    dataStore.aims = {
      p1: parent1,
      c1: child1,
      p2: parent2,
      c2: child2
    } as any

    uiStore.selectLink('p1', 'c1')

    const wrapper = mount(GraphSidePanel, {
      global: {
        plugins: [pinia]
      }
    })

    await wrapper.find('.explanation-view').trigger('click')

    const textarea = wrapper.find('textarea')
    await textarea.setValue('updated explanation')

    uiStore.selectLink('p2', 'c2')
    await textarea.trigger('blur')

    expect(trpc.aim.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        aimId: 'p1',
        aim: expect.objectContaining({
          supportingConnections: expect.arrayContaining([
            expect.objectContaining({ aimId: 'c1', explanation: 'updated explanation' })
          ])
        })
      })
    )

    const updatedParent1 = dataStore.aims.p1
    const updatedParent2 = dataStore.aims.p2
    if (!updatedParent1 || !updatedParent2) throw new Error('parents should exist in test setup')

    expect(updatedParent1.supportingConnections[0]?.explanation).toBe('updated explanation')
    expect(updatedParent2.supportingConnections[0]?.explanation).toBe('old-2')
  })
})
