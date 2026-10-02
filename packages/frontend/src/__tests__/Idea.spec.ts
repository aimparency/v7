import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import IdeaComponent from '../components/Idea.vue'
import { useDataStore, type Idea } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useUIModalStore } from '../stores/ui/modal-store'
import { createAimUIState } from '../stores/ui/idea-ui-state'
import { v4 as uuidv4 } from 'uuid'

// Mock sub-component to avoid recursion issues in testing
vi.mock('../components/IdeasList.vue', () => ({
  default: {
    template: '<div class="mock-ideas-list"></div>',
    props: [
      'ideas',
      'phaseId',
      'parentAimId',
      'columnIndex',
      'indentationLevel',
      'ideaUiStates',
      'isActive',
      'isSelected',
      'selectedAimIndex',
      'isThisAimSelected'  // for multi/selection compatibility
    ]
  }
}))

describe('Idea.vue', () => {
  const createMockAim = (overrides: Partial<Idea> = {}): Idea => ({
    id: uuidv4(),
    text: 'Test Idea',
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

  it('renders idea text', () => {
    const idea = createMockAim()
    const wrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: createAimUIState()
      }
    })

    expect(wrapper.text()).toContain('Test Idea')
  })

  it('opens the shared connection editor for a nested list idea', async () => {
    const parentId = uuidv4()
    const idea = createMockAim({ supportedAims: [parentId] })
    const modalStore = useUIModalStore()
    const openEditor = vi.spyOn(modalStore, 'openConnectionDetailsModal')
    const wrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        parentAimId: parentId,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: createAimUIState()
      }
    })

    await wrapper.find('.connection-edit-button').trigger('click')
    expect(openEditor).toHaveBeenCalledWith(parentId, idea.id)
  })

  it('displays sub-idea count when present', () => {
    // Create connection objects instead of strings
    const connections = [
        { ideaId: uuidv4(), relativePosition: [0,0] as [number, number], weight: 1 },
        { ideaId: uuidv4(), relativePosition: [0,0] as [number, number], weight: 1 },
        { ideaId: uuidv4(), relativePosition: [0,0] as [number, number], weight: 1 }
    ]
    const idea = createMockAim({ supportingConnections: connections }) 
    
    const wrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: createAimUIState()
      }
    })

    expect(wrapper.find('.stats-container').exists()).toBe(true)
    const statBottoms = wrapper.findAll('.stat-box .stat-bottom')
    expect(statBottoms.length).toBeGreaterThan(0)
    expect(statBottoms[0]?.text()).toBe('3')
  })

  it('loads sub-ideas when expanded', async () => {
    const dataStore = useDataStore()
    const subAimId = uuidv4()
    const connections = [
        { ideaId: subAimId, relativePosition: [0,0] as [number, number], weight: 1 }
    ]
    
    const idea = createMockAim({ supportingConnections: connections })
    const ideaUiState = createAimUIState()
    
    // Mock loadAims action
    dataStore.loadAims = vi.fn()

    const wrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState
      }
    })

    ideaUiState.expanded = true
    await wrapper.setProps({
      ideaUiState: { ...ideaUiState }
    })

    expect(dataStore.loadAims).toHaveBeenCalled()
  })

  it('uses per-rendered-idea UI state for expansion', () => {
    const dataStore = useDataStore()
    const childAimId = uuidv4()
    const idea = createMockAim({
      supportingConnections: [
        { ideaId: childAimId, relativePosition: [0, 0], weight: 1 }
      ]
    })
    const collapsedState = createAimUIState()
    const expandedState = createAimUIState()
    expandedState.expanded = true

    dataStore.loadAims = vi.fn()

    const collapsedWrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: collapsedState
      }
    })

    const expandedWrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: expandedState
      }
    })

    expect(collapsedWrapper.find('.mock-ideas-list').exists()).toBe(false)
    expect(expandedWrapper.find('.mock-ideas-list').exists()).toBe(true)
  })

  it('emits idea-clicked with modifiers for multi-select (ctrl/shift)', async () => {
    const idea = createMockAim()
    const wrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: createAimUIState()
      }
    })

    // Normal click
    await wrapper.find('.idea-item').trigger('click')
    const emits = wrapper.emitted('idea-clicked') || []
    expect(emits.length).toBeGreaterThan(0)
    const first = emits[0]
    expect(first?.[0]).toBe(idea.id)
    expect(first?.[1]).toEqual({ ctrl: false, shift: false })

    // Ctrl click for multi
    await wrapper.find('.idea-item').trigger('click', { ctrlKey: true })
    const last = (wrapper.emitted('idea-clicked') || []).slice(-1)[0]
    expect(last?.[0]).toBe(idea.id)
    expect(last?.[1]).toEqual({ ctrl: true, shift: false })

    // Shift click
    await wrapper.find('.idea-item').trigger('click', { shiftKey: true })
    const shiftLast = (wrapper.emitted('idea-clicked') || []).slice(-1)[0]
    expect(shiftLast?.[0]).toBe(idea.id)
    expect(shiftLast?.[1]).toEqual({ ctrl: false, shift: true })
  })

  it('toggles multi-selection on touch long-press', async () => {
    vi.useFakeTimers()
    const idea = createMockAim()
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    dataStore.ideas[idea.id] = idea
    const wrapper = mount(IdeaComponent, {
      global: { plugins: [pinia] },
      props: {
        idea,
        phaseId: 'test-phase',
        columnIndex: 0,
        isActive: false,
        isSelected: false,
        ideaUiState: createAimUIState()
      }
    })

    const pointerDown = new Event('pointerdown', { bubbles: true })
    Object.defineProperties(pointerDown, {
      pointerType: { value: 'touch' },
      clientX: { value: 10 },
      clientY: { value: 10 }
    })
    wrapper.find('.idea-header').element.dispatchEvent(pointerDown)
    await vi.advanceTimersByTimeAsync(450)

    expect(uiStore.multiSelectedAimIds).toEqual([idea.id])
    expect(uiStore.multiSelectMode).toBe(true)
    vi.useRealTimers()
  })
})
