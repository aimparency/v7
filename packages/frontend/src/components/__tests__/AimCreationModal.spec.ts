import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimCreationModal from '../AimCreationModal.vue'
import { useUIStore } from '../../stores/ui'
import { useUIModalStore } from '../../stores/ui/modal-store'

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
    // Override openAimSearch to simulate selection
    modalStore.openAimSearch.mockImplementation((mode: string) => {
        // Execute the callback immediately
        if (modalStore.aimSearchCallback) {
            modalStore.aimSearchCallback({ id: 'p1', text: 'Parent 1' })
        }
    })

    const addBtn = wrapper.find('button[title="Add Parent"]')
    await addBtn.trigger('click')
    
    expect(wrapper.text()).toContain('Parent 1')
    expect(wrapper.findAll('.supported-aim-row').length).toBe(1)
    
    // Verify removal
    await wrapper.find('.btn-remove').trigger('click')
    expect(wrapper.findAll('.supported-aim-row').length).toBe(0)
  })

  it('adds supporting connection (child)', async () => {
    modalStore.openAimSearch.mockImplementation((mode: string) => {
        if (modalStore.aimSearchCallback) {
            modalStore.aimSearchCallback({ id: 'c1', text: 'Child 1' })
        }
    })

    const addBtn = wrapper.find('button[title="Add Child"]')
    await addBtn.trigger('click')
    
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
})
