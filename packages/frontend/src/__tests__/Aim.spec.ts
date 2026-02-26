import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimComponent from '../components/Aim.vue'
import { useDataStore, type Aim } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { v4 as uuidv4 } from 'uuid'

// Mock sub-component to avoid recursion issues in testing
vi.mock('../components/AimsList.vue', () => ({
  default: {
    template: '<div class="mock-aims-list"></div>',
    props: ['aims']
  }
}))

describe('Aim.vue', () => {
  const createMockAim = (overrides: Partial<Aim> = {}): Aim => ({
    id: uuidv4(),
    text: 'Test Aim',
    description: 'Test Description',
    tags: [],
    reflections: [],
    status: {
      state: 'open',
      comment: '',
      date: Date.now()
    },
    supportingConnections: [], // Updated from incoming
    supportedAims: [],
    committedIn: [],
    expanded: false,
    selectedIncomingIndex: undefined,
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0,
    archived: false,
    ...overrides
  })

  let pinia: any

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false
    })
  })

  it('renders aim text', () => {
    const aim = createMockAim()
    const wrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false
      }
    })

    expect(wrapper.text()).toContain('Test Aim')
  })

  it('displays sub-aim count when present', () => {
    // Create connection objects instead of strings
    const connections = [
        { aimId: uuidv4(), relativePosition: [0,0] as [number, number], weight: 1 },
        { aimId: uuidv4(), relativePosition: [0,0] as [number, number], weight: 1 },
        { aimId: uuidv4(), relativePosition: [0,0] as [number, number], weight: 1 }
    ]
    const aim = createMockAim({ supportingConnections: connections }) 
    
    const wrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false
      }
    })

    expect(wrapper.find('.stat-count').exists()).toBe(true)
    expect(wrapper.find('.stat-count').text()).toBe('3')
  })

  it('loads sub-aims when expanded', async () => {
    const dataStore = useDataStore()
    const subAimId = uuidv4()
    const connections = [
        { aimId: subAimId, relativePosition: [0,0] as [number, number], weight: 1 }
    ]
    
    const aim = createMockAim({ supportingConnections: connections })
    
    // Mock loadAims action
    dataStore.loadAims = vi.fn()

    const wrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false
      }
    })

    // Simulate expansion by updating prop (in real app, parent handles expansion state usually, 
    // or dataStore does. Here we simulate the prop change trigger if we modify the aim object reactive?)
    // Actually Aim.vue watches `isExpanded` computed from `props.aim.expanded`.
    // We need to update the prop object.
    
    await wrapper.setProps({
      aim: { ...aim, expanded: true }
    })

    expect(dataStore.loadAims).toHaveBeenCalled()
  })
})