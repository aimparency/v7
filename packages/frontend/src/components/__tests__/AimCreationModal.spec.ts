import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimCreationModal from '../AimCreationModal.vue'
import { useUIStore } from '../../stores/ui'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { trpc } from '../../trpc'

// Mock TRPC
vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      search: { query: vi.fn().mockResolvedValue([]) },
      searchSemantic: { query: vi.fn().mockResolvedValue([]) },
      get: { query: vi.fn() }
    }
  }
}))

describe('AimCreationModal', () => {
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
    uiStore.getSelectionPath.mockReturnValue({ aims: [], phase: null })

    wrapper = mount(AimCreationModal, {
      global: {
        plugins: [pinia]
      }
    })

    ;(trpc.aim.search.query as any).mockResolvedValue([])
    ;(trpc.aim.searchSemantic.query as any).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders correctly', () => {
    expect(wrapper.text()).toContain('Add Aim')
  })

  it('handles text input and creation', async () => {
    const input = wrapper.find('input[placeholder="Enter aim text"]')
    await input.setValue('New Aim')
    
    await wrapper.find('.btn-primary').trigger('click')
    
    // Check arguments passed to createAim
    // (text, isExisting, desc, tags, intrinsic, loop, cost, weight, supported, supporting)
    expect(uiStore.createAim).toHaveBeenCalledWith(
      'New Aim',
      false,
      '',
      [],
      0,
      1,
      1,
      1,
      [],
      []
    )
  })

  it('adds supported aim (parent)', async () => {
    const addBtn = wrapper.find('button[title="Add Parent"]')
    await addBtn.trigger('click')

    expect(modalStore.openAimSearch).toHaveBeenCalledWith(
      'pick',
      expect.any(Function),
      undefined,
      expect.objectContaining({ title: 'Select Supported Aim' })
    )
    const callback = modalStore.openAimSearch.mock.calls[0]?.[1]
    callback({ type: 'aim', data: { id: 'p1', text: 'Parent 1' } })
    await wrapper.vm.$nextTick()
    
    expect(wrapper.text()).toContain('Parent 1')
    expect(wrapper.findAll('.supported-aim-row').length).toBe(1)
    
    // Verify removal
    await wrapper.find('.btn-remove').trigger('click')
    expect(wrapper.findAll('.supported-aim-row').length).toBe(0)
  })

  it('adds supporting connection (child)', async () => {
    const addBtn = wrapper.find('button[title="Add Child"]')
    await addBtn.trigger('click')

    expect(modalStore.openAimSearch).toHaveBeenCalledWith(
      'pick',
      expect.any(Function),
      undefined,
      expect.objectContaining({ title: 'Select Supporting Aim' })
    )
    const callback = modalStore.openAimSearch.mock.calls[0]?.[1]
    callback({ type: 'aim', data: { id: 'c1', text: 'Child 1' } })
    await wrapper.vm.$nextTick()
    
    expect(wrapper.text()).toContain('Child 1')
    // Should have weight input
    const weightInput = wrapper.find('input.weight-field')
    expect(weightInput.exists()).toBe(true)
    await weightInput.setValue(5)
    
    // Create and verify payload
    const input = wrapper.find('input[placeholder="Enter aim text"]')
    await input.setValue('Parent Aim')
    await wrapper.find('.btn-primary').trigger('click')
    
    expect(uiStore.createAim).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        [], // Parents
        [{ aimId: 'c1', weight: 5 }] // Children
    )
  })

  it('defaults to creating a new aim when multiple perfect matches exist', async () => {
    ;(trpc.aim.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor', status: { state: 'open' } },
      { id: 'a2', text: 'Refactor', status: { state: 'open' } }
    ])

    const input = wrapper.find('input[placeholder="Enter aim text"]')
    await input.setValue('Refactor')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.find('.btn-primary').trigger('click')

    // With ambiguous perfect matches, index stays on "create new" entry.
    expect(uiStore.createAim).toHaveBeenCalledWith(
      'Refactor',
      false,
      '',
      [],
      0,
      1,
      1,
      1,
      [],
      []
    )
  })

  it('submits the focused embedded search result on Enter', async () => {
    ;(trpc.aim.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 },
      { id: 'a2', text: 'Refactor auth', status: { state: 'open' }, score: 0.8 }
    ])

    const input = wrapper.find('input[placeholder="Enter aim text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    expect(results).toHaveLength(3)

    await results[0]!.trigger('focus')
    await results[0]!.trigger('keydown', { key: 'j' })
    await results[1]!.trigger('keydown', { key: 'Enter' })

    expect(uiStore.createAim).toHaveBeenCalledWith(
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
    ;(trpc.aim.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 }
    ])

    const input = wrapper.find('input[placeholder="Enter aim text"]')
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
    ;(trpc.aim.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 }
    ])

    const input = wrapper.find('input[placeholder="Enter aim text"]')
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

    expect(modalStore.closeAimModal).toHaveBeenCalled()
  })

  it('keeps description Escape local and does not bubble to close the modal', async () => {
    const description = wrapper.find('textarea[placeholder="Enter aim description"]')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()

    await description.trigger('keydown', {
      key: 'Escape',
      preventDefault,
      stopPropagation
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()

    modalStore.closeAimModal.mockClear()
    description.element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    }))
    await wrapper.vm.$nextTick()

    expect(modalStore.closeAimModal).not.toHaveBeenCalled()
  })

  it('returns focus to the title input on Shift+Tab from embedded search', async () => {
    ;(trpc.aim.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 }
    ])

    const input = wrapper.find('input[placeholder="Enter aim text"]')
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
    ;(trpc.aim.search.query as any).mockResolvedValue([
      { id: 'a1', text: 'Refactor old auth', status: { state: 'open' }, score: 0.9 },
      { id: 'a2', text: 'Refactor auth', status: { state: 'open' }, score: 0.8 }
    ])

    const input = wrapper.find('input[placeholder="Enter aim text"]')
    await input.setValue('Refactor')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()

    const results = wrapper.findAll('.result-item')
    expect(results).toHaveLength(3)

    await results[2]!.trigger('mouseenter')
    await wrapper.find('.btn-primary').trigger('click')

    expect(uiStore.createAim).toHaveBeenCalledWith(
      'Refactor',
      false,
      '',
      [],
      0,
      1,
      1,
      1,
      [],
      []
    )

    uiStore.createAim.mockClear()

    await results[2]!.trigger('click')
    expect(uiStore.createAim).toHaveBeenCalledWith(
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
    const input = wrapper.find('input[placeholder="Enter aim text"]')

    await input.setValue('jk')

    expect((input.element as HTMLInputElement).value).toBe('jk')
  })
})
