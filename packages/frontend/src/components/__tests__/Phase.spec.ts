import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import PhaseComponent from '../Phase.vue'
import { useDataStore, type Idea, type Phase } from '../../stores/data'
import { useProjectStore } from '../../stores/project-store'
import { useUIModalStore } from '../../stores/ui/modal-store'

const makePhase = (id: string, commitments: string[], childPhaseIds: string[] = []): Phase => ({
  id,
  name: id === 'root' ? 'SPC application' : 'Application subphase',
  parent: id === 'root' ? null : 'root',
  commitments,
  childPhaseIds
})

const makeIdea = (
  id: string,
  text: string,
  state: string,
  committedIn: string[],
  children: string[] = []
): Idea => ({
  id,
  text,
  archived: false,
  tags: [],
  supportingConnections: children.map(ideaId => ({
    ideaId,
    weight: 1,
    relativePosition: [0, 0] as [number, number]
  })),
  supportedIdeas: [],
  committedIn,
  status: { state, comment: '', date: 0 },
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 0,
  duration: 1,
  costVariance: 0,
  valueVariance: 0,
  reflections: []
})

function mountPhase() {
  const root = makePhase('root', ['application', 'direct'], ['child-phase'])
  const childPhase = makePhase('child-phase', [])
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      data: {
        phases: { root, 'child-phase': childPhase },
        ideas: {
          application: makeIdea('application', 'SPC application', 'partially', ['root'], ['founder-facts']),
          'founder-facts': makeIdea('founder-facts', 'Confirm founder facts', 'human-dependent', []),
          direct: makeIdea('direct', 'Authorize submission', 'human-dependent', ['root'])
        },
        meta: {
          statuses: [
            { key: 'open', color: '#fff', ongoing: true },
            { key: 'human-dependent', color: '#f90', ongoing: true }
          ]
        }
      },
      project: { projectPath: '/test/project' }
    }
  })
  const dataStore = useDataStore(pinia)
  const projectStore = useProjectStore(pinia)
  const modalStore = useUIModalStore(pinia)
  projectStore.projectPath = '/test/project'
  dataStore.calculatedPriorities = new Map([
    ['founder-facts', 9],
    ['direct', 4]
  ])

  const wrapper = mount(PhaseComponent, {
    props: { phase: root, isSelected: true, isActive: true },
    global: {
      plugins: [pinia],
      stubs: { IdeasList: true, ContextMenu: true }
    }
  })

  return { wrapper, dataStore, modalStore }
}

describe('Phase priority list', () => {
  it('opens with human-dependent direct and transitive ideas and opens the selected idea', async () => {
    const { wrapper, dataStore, modalStore } = mountPhase()

    expect(wrapper.find('.priority-panel').exists()).toBe(false)
    expect(wrapper.find('.ideas-container').exists()).toBe(true)

    await wrapper.find('.priority-toggle').trigger('click')
    await flushPromises()

    expect((wrapper.find('.priority-state select').element as HTMLSelectElement).value).toBe('human-dependent')
    expect(wrapper.find('.ideas-container').exists()).toBe(false)

    const results = wrapper.findAll('.priority-idea')
    expect(results.map(result => result.text())).toEqual([
      expect.stringContaining('Confirm founder facts'),
      expect.stringContaining('Authorize submission')
    ])
    expect(results[0]!.text()).toContain('via committed idea')
    expect(results[1]!.text()).not.toContain('via committed idea')

    await results[0]!.trigger('click')
    expect(modalStore.openIdeaEditModal).toHaveBeenCalledWith('founder-facts')
  })
})
