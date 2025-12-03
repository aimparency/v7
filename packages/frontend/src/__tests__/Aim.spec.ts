import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Aim from '../components/Aim.vue'

const uuidv4 = () => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)

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

  it('displays description when expanded and description exists', () => {
    const aim = createMockAim({
      description: 'This is a description',
      expanded: true
    })
    const wrapper = mount(Aim, {
      props: {
        aim,
        phaseId: uuidv4()
      }
    })
    const desc = wrapper.find('.aim-description')
    expect(desc.exists()).toBe(true)
    expect(desc.text()).toBe('This is a description')
  })

  it('does not display description when collapsed', () => {
    const aim = createMockAim({
      description: 'This is a description',
      expanded: false
    })
    const wrapper = mount(Aim, {
      props: {
        aim,
        phaseId: uuidv4()
      }
    })
    const desc = wrapper.find('.aim-description')
    expect(desc.exists()).toBe(false)
  })

  it('does not display description when expanded but description is empty', () => {
    const aim = createMockAim({
      description: '',
      expanded: true
    })
    const wrapper = mount(Aim, {
      props: {
        aim,
        phaseId: uuidv4()
      }
    })
    const desc = wrapper.find('.aim-description')
    expect(desc.exists()).toBe(false)
  })
})
