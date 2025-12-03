import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Aim from '../components/Aim.vue'
import { v4 as uuidv4 } from 'uuid'
import type { Aim as AimType } from '../../shared/src/types' // Corrected import path

// Mock the useDataStore and useUIStore
vi.mock('../stores/data', () => ({
  useDataStore: () => ({
    aims: {},
    project: {
      meta: {
        name: 'test',
        color: '#ffffff'
      }
    }
  })
}))

vi.mock('../stores/ui', () => ({
  useUIStore: () => ({
    selectedAimId: null,
    activePhaseId: null
  })
}))

const createMockAim = (overrides?: Partial<AimType>): AimType => ({
  id: uuidv4(),
  text: 'Test Aim',
  incoming: [],
  outgoing: [],
  committedIn: [],
  status: { state: 'open', comment: '', date: Date.now() },
  ...overrides
})

describe('Aim.vue', () => {
  it('does not display sub-aim bubble when there are no sub-aims', () => {
    const aim = createMockAim()
    const wrapper = mount(Aim, {
      props: {
        aim,
        phaseId: uuidv4()
      }
    })
    expect(wrapper.find('.sub-aim-count-bubble').exists()).toBe(false)
  })

  it('displays sub-aim bubble with correct count when there are sub-aims (less than 10)', () => {
    const aim = createMockAim({ incoming: [uuidv4(), uuidv4(), uuidv4()] }) // 3 sub-aims
    const wrapper = mount(Aim, {
      props: {
        aim,
        phaseId: uuidv4()
      }
    })
    const bubble = wrapper.find('.sub-aim-count-bubble')
    expect(bubble.exists()).toBe(true)
    expect(bubble.text()).toBe('3')
  })

  it('displays sub-aim bubble with "N" when there are 10 or more sub-aims', () => {
    const incomingAims = Array.from({ length: 12 }, () => uuidv4()) // 12 sub-aims
    const aim = createMockAim({ incoming: incomingAims })
    const wrapper = mount(Aim, {
      props: {
        aim,
        phaseId: uuidv4()
      }
    })
    const bubble = wrapper.find('.sub-aim-count-bubble')
    expect(bubble.exists()).toBe(true)
    expect(bubble.text()).toBe('N')
  })
})
