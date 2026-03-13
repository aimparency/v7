import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimCreationModal from '../AimCreationModal.vue'
import { useUIStore } from '../../stores/ui'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { useDataStore } from '../../stores/data'
import { trpc } from '../../trpc'

// Mock TRPC
vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      search: { query: vi.fn().mockResolvedValue([]) },
      get: { query: vi.fn() }
    }
  }
}))

describe('AimCreationModal', () => {
  let wrapper: any
  let uiStore: any
  let modalStore: any

  const mountEditModal = () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-modal': { aimModalMode: 'edit' },
        'ui-project': { projectPath: '/test/project' },
        data: { meta: { statuses: [{ key: 'open', color: '#fff' }, { key: 'done', color: '#0f0' }] } }
      }
    })

    const editUiStore = useUIStore(pinia)
    const editModalStore = useUIModalStore(pinia)
    ;(editUiStore.getCurrentAim as any).mockReturnValue({
      id: 'aim-1',
      text: 'Old Title',
      description: '',
      tags: [],
      status: { state: 'open', comment: '' },
      intrinsicValue: 0,
      cost: 1,
      loopWeight: 1,
      supportedAims: []
    })

    const editWrapper = mount(AimCreationModal, {
      global: { plugins: [pinia] }
    })

    const editDataStore: any = useDataStore(pinia)
    return { editWrapper, editDataStore, editModalStore }
  }

  beforeEach(() => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-modal': {
          aimModalMode: 'create',
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
  })

  it('renders correctly', () => {
    expect(wrapper.find('.modal-header h3').text()).toBe('Add Aim')
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

    expect(modalStore.openAimSearch).toHaveBeenCalledWith('pick', expect.any(Function))
    const callback = modalStore.openAimSearch.mock.calls[0]?.[1]
    callback({ id: 'p1', text: 'Parent 1' })
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

    expect(modalStore.openAimSearch).toHaveBeenCalledWith('pick', expect.any(Function))
    const callback = modalStore.openAimSearch.mock.calls[0]?.[1]
    callback({ id: 'c1', text: 'Child 1' })
    await wrapper.vm.$nextTick()
    
    expect(wrapper.text()).toContain('Child 1')
    // Should have weight input
    const weightInput = wrapper.find('input[type="number"].weight-field')
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

  it('saves on Enter for edit mode input fields', async () => {
    const { editWrapper, editDataStore, editModalStore } = mountEditModal()

    const titleInput = editWrapper.find('input[placeholder="Enter aim text"]')
    await titleInput.setValue('Updated Title')
    await titleInput.trigger('keydown', { key: 'Enter' })
    await editWrapper.vm.$nextTick()

    expect(editDataStore.updateAim).toHaveBeenCalled()
    expect(editModalStore.closeAimModal).toHaveBeenCalled()
  })

  it('saves on Enter for edit mode status select', async () => {
    const { editWrapper, editDataStore, editModalStore } = mountEditModal()

    const statusSelect = editWrapper.find('select.status-select')
    await statusSelect.setValue('done')
    await statusSelect.trigger('keydown', { key: 'Enter' })
    await editWrapper.vm.$nextTick()

    expect(editDataStore.updateAim).toHaveBeenCalled()
    expect(editModalStore.closeAimModal).toHaveBeenCalled()
  })

  it('does not save on plain Enter in description textarea but saves on Ctrl+Enter', async () => {
    const { editWrapper, editDataStore, editModalStore } = mountEditModal()

    const description = editWrapper.find('textarea[placeholder="Enter aim description"]')
    await description.setValue('Line one')
    await description.trigger('keydown', { key: 'Enter' })
    await editWrapper.vm.$nextTick()

    expect(editDataStore.updateAim).not.toHaveBeenCalled()
    expect(editModalStore.closeAimModal).not.toHaveBeenCalled()

    await description.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await editWrapper.vm.$nextTick()

    expect(editDataStore.updateAim).toHaveBeenCalled()
    expect(editModalStore.closeAimModal).toHaveBeenCalled()
  })
})
