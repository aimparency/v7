import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimComponent from '../components/Aim.vue'
import { useDataStore, type Aim } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { createAimUIState } from '../stores/ui/aim-ui-state'
import { v4 as uuidv4 } from 'uuid'

// Mock sub-component to avoid recursion issues in testing
vi.mock('../components/AimsList.vue', () => ({
  default: {
    template: '<div class="mock-aims-list"></div>',
    props: [
      'aims',
      'phaseId',
      'parentAimId',
      'columnIndex',
      'indentationLevel',
      'aimUiStates',
      'isActive',
      'isSelected',
      'selectedAimIndex',
      'isThisAimSelected'  // for multi/selection compatibility
    ]
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
        isSelected: false,
        aimUiState: createAimUIState()
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
        isSelected: false,
        aimUiState: createAimUIState()
      }
    })

    expect(wrapper.find('.stats-container').exists()).toBe(true)
    const statBottoms = wrapper.findAll('.stat-box .stat-bottom')
    expect(statBottoms.length).toBeGreaterThan(0)
    expect(statBottoms[0]?.text()).toBe('3')
  })

  it('loads sub-aims when expanded', async () => {
    const dataStore = useDataStore()
    const subAimId = uuidv4()
    const connections = [
        { aimId: subAimId, relativePosition: [0,0] as [number, number], weight: 1 }
    ]
    
    const aim = createMockAim({ supportingConnections: connections })
    const aimUiState = createAimUIState()
    
    // Mock loadAims action
    dataStore.loadAims = vi.fn()

    const wrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        aimUiState
      }
    })

    aimUiState.expanded = true
    await wrapper.setProps({
      aimUiState: { ...aimUiState }
    })

    expect(dataStore.loadAims).toHaveBeenCalled()
  })

  it('uses per-rendered-aim UI state for expansion', () => {
    const dataStore = useDataStore()
    const childAimId = uuidv4()
    const aim = createMockAim({
      supportingConnections: [
        { aimId: childAimId, relativePosition: [0, 0], weight: 1 }
      ]
    })
    const collapsedState = createAimUIState()
    const expandedState = createAimUIState()
    expandedState.expanded = true

    dataStore.loadAims = vi.fn()

    const collapsedWrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        aimUiState: collapsedState
      }
    })

    const expandedWrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        aimUiState: expandedState
      }
    })

    expect(collapsedWrapper.find('.mock-aims-list').exists()).toBe(false)
    expect(expandedWrapper.find('.mock-aims-list').exists()).toBe(true)
  })

  it('emits aim-clicked with modifiers for multi-select (ctrl/shift)', async () => {
    const aim = createMockAim()
    const wrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        aimUiState: createAimUIState()
      }
    })

    // Normal click
    await wrapper.find('.aim-item').trigger('click')
    const emits = wrapper.emitted('aim-clicked') || []
    expect(emits.length).toBeGreaterThan(0)
    const first = emits[0]
    expect(first?.[0]).toBe(aim.id)
    expect(first?.[1]).toEqual({ ctrl: false, shift: false })

    // Ctrl click for multi
    await wrapper.find('.aim-item').trigger('click', { ctrlKey: true })
    const last = (wrapper.emitted('aim-clicked') || []).slice(-1)[0]
    expect(last?.[0]).toBe(aim.id)
    expect(last?.[1]).toEqual({ ctrl: true, shift: false })

    // Shift click
    await wrapper.find('.aim-item').trigger('click', { shiftKey: true })
    const shiftLast = (wrapper.emitted('aim-clicked') || []).slice(-1)[0]
    expect(shiftLast?.[0]).toBe(aim.id)
    expect(shiftLast?.[1]).toEqual({ ctrl: false, shift: true })
  })

  it('toggles multi-selection on touch long-press', async () => {
    vi.useFakeTimers()
    const aim = createMockAim()
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    dataStore.aims[aim.id] = aim
    const wrapper = mount(AimComponent, {
      global: { plugins: [pinia] },
      props: {
        aim,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        aimUiState: createAimUIState()
      }
    })

    const pointerDown = new Event('pointerdown', { bubbles: true })
    Object.defineProperties(pointerDown, {
      pointerType: { value: 'touch' },
      clientX: { value: 10 },
      clientY: { value: 10 }
    })
    wrapper.find('.aim-header').element.dispatchEvent(pointerDown)
    await vi.advanceTimersByTimeAsync(450)

    expect(uiStore.multiSelectedAimIds).toEqual([aim.id])
    vi.useRealTimers()
  })
})
