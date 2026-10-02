import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import IdeaCreationModal from '../IdeaCreationModal.vue'
import { useUIStore } from '../../stores/ui'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { trpc } from '../../trpc'

// Mock TRPC
vi.mock('../../trpc', () => ({
  trpc: {
    idea: {
      search: { query: vi.fn().mockResolvedValue([]) },
      searchSemantic: { query: vi.fn().mockResolvedValue([]) },
      get: { query: vi.fn() }
    }
  }
}))

describe('IdeaCreationModal', () => {
  let wrapper: any
  let uiStore: any
  let modalStore: any

  beforeEach(() => {
    vi.useFakeTimers()
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-modal': {
        },
        'ui-project': {
          projectPath: '/test/project'
        },
        data: {
            meta: { statuses: [{key:'open', color:'#fff'}] }
        }
      }
    })
    
    // Configure mock before mount
    uiStore = useUIStore(pinia)
    modalStore = useUIModalStore(pinia)
    uiStore.getSelectionPath.mockReturnValue({ ideas: [], ideaStates: [], phase: null })

    wrapper = mount(IdeaCreationModal, {
      global: {
        plugins: [pinia]
      }
    })

    ;(trpc.idea.search.query as any).mockResolvedValue([])
    ;(trpc.idea.searchSemantic.query as any).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const mountWithSelectedSubIdea = (source: 'columns' | 'graph') => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-modal': { ideaModalSource: source },
        'ui-project': { projectPath: '/test/project' },
        data: { meta: { statuses: [{ key: 'open', color: '#fff' }] } }
      }
    })
    const store = useUIStore(pinia)
    store.getSelectionPath.mockReturnValue({
      ideas: [{ id: 'columns-parent', text: 'Columns parent' }, { id: 'columns-child', text: 'Columns child' }],
      ideaStates: [{}, {}],
      phase: null
    })
    return mount(IdeaCreationModal, { global: { plugins: [pinia] } })
  }

  it('prefills the columns selection parent when opened from columns', async () => {
    const columnsWrapper = mountWithSelectedSubIdea('columns')
    await columnsWrapper.vm.$nextTick()
    expect(columnsWrapper.text()).toContain('Columns parent')
  })

  it('does not prefill a columns parent when opened from the graph', async () => {
    const graphWrapper = mountWithSelectedSubIdea('graph')
    await graphWrapper.vm.$nextTick()
    expect(graphWrapper.text()).not.toContain('Columns parent')
  })

  it('renders correctly', () => {
    expect(wrapper.text()).toContain('Add Idea')
  })

  it('handles text input and creation', async () => {
    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('New Idea')
    
    await wrapper.find('.btn-primary').trigger('click')
    
    // Check arguments passed to createIdea
    // (text, isExisting, desc, tags, intrinsic, loop, cost, weight, supported, supporting)
    expect(uiStore.createIdea).toHaveBeenCalledWith(
      'New Idea',
      false,
      '',
      [],
      0,
      1,
      1,
      1,
      [],
      [],
      null,
      'open',
      '',
      1,
      ''
    )
  })

  it('ignores repeated Enter while a creation is still in flight', async () => {
    let resolveCreate: () => void = () => {}
    uiStore.createIdea.mockImplementation(() => new Promise<void>(resolve => {
      resolveCreate = resolve
    }))

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Slow Idea')

    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(uiStore.createIdea).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined()

    resolveCreate()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeUndefined()
  })

  it('passes the human-authored value rationale into idea creation', async () => {
    await wrapper.find('input[placeholder="Enter idea text"]').setValue('Valued Idea')
    await wrapper.find('textarea[placeholder^="Explain the evidence"]').setValue('Validated customer outcome')
    await wrapper.find('.btn-primary').trigger('click')

    const args = uiStore.createIdea.mock.calls.at(-1)
    expect(args?.at(-1)).toBe('Validated customer outcome')
  })

  it('adds supported idea (parent)', async () => {
    const addBtn = wrapper.find('button[title="Add Parent"]')
    await addBtn.trigger('click')

    expect(modalStore.openIdeaSearch).toHaveBeenCalledWith(
      'pick',
      expect.any(Function),
      undefined,
      expect.objectContaining({ title: 'Select Supported Idea' })
    )
    const callback = modalStore.openIdeaSearch.mock.calls[0]?.[1]
    callback({ type: 'idea', data: { id: 'p1', text: 'Parent 1' } })
    await wrapper.vm.$nextTick()
    
    expect(wrapper.text()).toContain('Parent 1')
    expect(wrapper.findAll('.supported-idea-row').length).toBe(1)
    
    // Verify removal
    await wrapper.find('.btn-remove').trigger('click')
    expect(wrapper.findAll('.supported-idea-row').length).toBe(0)
  })

  it('adds supporting connection (child)', async () => {
    const addBtn = wrapper.find('button[title="Add Child"]')
    await addBtn.trigger('click')

    expect(modalStore.openIdeaSearch).toHaveBeenCalledWith(
      'pick',
      expect.any(Function),
      undefined,
      expect.objectContaining({ title: 'Select Supporting Idea' })
    )
    const callback = modalStore.openIdeaSearch.mock.calls[0]?.[1]
    callback({ type: 'idea', data: { id: 'c1', text: 'Child 1' } })
    await wrapper.vm.$nextTick()
    
    expect(wrapper.text()).toContain('Child 1')
    // Should have weight input
    const weightInput = wrapper.find('input.weight-field')
    expect(weightInput.exists()).toBe(true)
    await weightInput.setValue(5)
    
    // Create and verify payload
    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Parent Idea')
    await wrapper.find('.btn-primary').trigger('click')
    
    expect(uiStore.createIdea).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        [], // Parents
        [{ ideaId: 'c1', weight: 5 }], // Children
        null,
        'open',
        '',
        1,
        ''
    )
  })

  it('defaults to creating a new idea when multiple perfect matches exist', async () => {
    ;(trpc.idea.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor', status: { state: 'open' } },
      { id: 'a2', text: 'Refactor', status: { state: 'open' } }
    ])

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Refactor')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.btn-primary').trigger('click')

    // With ambiguous perfect matches, index stays on "create new" entry.
    expect(uiStore.createIdea).toHaveBeenCalledWith(
      'Refactor',
      false,
      '',
      [],
      0,
      1,
      1,
      1,
      [],
      [],
      null,
      'open',
      '',
      1,
      ''
    )
  })

  it('submits the focused embedded search result on Enter', async () => {
    ;(trpc.idea.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 },
      { id: 'a2', text: 'Refactor auth', status: { state: 'open' }, score: 0.8 }
    ])

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    expect(results).toHaveLength(3)

    await results[0]!.trigger('focus')
    await results[0]!.trigger('keydown', { key: 'j' })
    await results[1]!.trigger('keydown', { key: 'Enter' })

    expect(uiStore.createIdea).toHaveBeenCalledWith(
      'a1',
      true,
      undefined,
      undefined,
      0,
      1,
      1,
      1
    )
  })

  it('tabs from the title input into the embedded search list', async () => {
    ;(trpc.idea.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 }
    ])

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()

    await input.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    expect(results).toHaveLength(2)
    expect(results[0]!.attributes('tabindex')).toBe('0')
  })

  it('returns focus to the title input on Escape from embedded search', async () => {
    ;(trpc.idea.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 }
    ])

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()
    const focusSpy = vi.spyOn(input.element as HTMLInputElement, 'focus')

    await input.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    await results[0]!.trigger('keydown', { key: 'Escape' })

    expect(focusSpy).toHaveBeenCalled()
  })

  it('closes on Escape handled by the modal shell', async () => {
    await wrapper.find('.modal-overlay').trigger('keydown', { key: 'Escape' })

    expect(modalStore.closeIdeaModal).toHaveBeenCalled()
  })

  it('keeps description Escape local and does not bubble to close the modal', async () => {
    const description = wrapper.find('textarea[placeholder="Enter idea description"]')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()

    await description.trigger('keydown', {
      key: 'Escape',
      preventDefault,
      stopPropagation
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()

    modalStore.closeIdeaModal.mockClear()
    description.element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    }))
    await wrapper.vm.$nextTick()

    expect(modalStore.closeIdeaModal).not.toHaveBeenCalled()
  })

  it('returns focus to the title input on Shift+Tab from embedded search', async () => {
    ;(trpc.idea.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 }
    ])

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()
    const focusSpy = vi.spyOn(input.element as HTMLInputElement, 'focus')

    await input.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    await results[0]!.trigger('keydown', { key: 'Tab', shiftKey: true })

    expect(focusSpy).toHaveBeenCalled()
  })

  it('does not change embedded selection on hover and click confirms directly', async () => {
    ;(trpc.idea.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 },
      { id: 'a2', text: 'Refactor auth', status: { state: 'open' }, score: 0.8 }
    ])

    const input = wrapper.find('input[placeholder="Enter idea text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    expect(results).toHaveLength(3)

    await results[2]!.trigger('mouseenter')
    await wrapper.find('.btn-primary').trigger('click')

    expect(uiStore.createIdea).toHaveBeenCalledWith(
      'Refactor',
      false,
      '',
      [],
      0,
      1,
      1,
      1,
      [],
      [],
      null,
      'open',
      '',
      1,
      ''
    )

    uiStore.createIdea.mockClear()

    await results[2]!.trigger('click')
    expect(uiStore.createIdea).toHaveBeenCalledWith(
      'a2',
      true,
      undefined,
      undefined,
      0,
      1,
      1,
      1
    )
  })

  it('allows typing j and k in the title input', async () => {
    const input = wrapper.find('input[placeholder="Enter idea text"]')

    await input.setValue('jk')

    expect((input.element as HTMLInputElement).value).toBe('jk')
  })
})
