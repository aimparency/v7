import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import PhaseCreationModal from '../PhaseCreationModal.vue'
import { useUIModalStore } from '../../stores/ui/modal-store'

vi.mock('../../trpc', () => ({
  trpc: {
    phase: {
      get: { query: vi.fn().mockResolvedValue({ id: 'parent-1', name: 'Parent Phase' }) },
      update: { mutate: vi.fn() }
    }
  }
}))

function mountPhaseModal() {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      ui: {
        activeColumn: 0,
        selectedPhaseByColumn: { 0: 0 },
        maxColumn: 0
      },
      'ui-modal': {
        showPhaseModal: true,
        phaseModalMode: 'create',
        phaseModalEditingPhaseId: null,
        phaseModalEditingParentId: null,
        newPhaseName: 'New phase',
        phaseModalInsertPosition: 'before'
      },
      'ui-project': {
        projectPath: '/test/project'
      },
      data: {
        phases: {},
        meta: { rootPhaseIds: [] }
      }
    }
  })

  const modalStore = useUIModalStore(pinia)
  const wrapper = mount(PhaseCreationModal, {
    global: {
      plugins: [pinia],
      stubs: {
        PhaseSearchModal: true
      }
    }
  })

  return { wrapper, modalStore }
}

describe('PhaseCreationModal Escape behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes create mode on Escape handled by the modal shell', async () => {
    const { wrapper, modalStore } = mountPhaseModal()

    await wrapper.find('.modal-overlay').trigger('keydown', { key: 'Escape' })

    expect(modalStore.closePhaseModal).toHaveBeenCalled()
  })

  it('closes from the phase name input on Escape without bubbling to the shell', async () => {
    const { wrapper, modalStore } = mountPhaseModal()
    const input = wrapper.find('input[placeholder="Enter phase name"]')
    const overlay = wrapper.find('.modal-overlay')
    const bubbled = vi.fn()
    overlay.element.addEventListener('keydown', bubbled)

    input.element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    }))
    await wrapper.vm.$nextTick()

    expect(modalStore.closePhaseModal).toHaveBeenCalledTimes(1)
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('closes edit mode on Escape handled by the modal shell', async () => {
    const { wrapper, modalStore } = mountPhaseModal()
    modalStore.phaseModalMode = 'edit'
    modalStore.phaseModalEditingPhaseId = 'phase-1'
    modalStore.phaseModalEditingParentId = null
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-overlay').trigger('keydown', { key: 'Escape' })

    expect(modalStore.closePhaseModal).toHaveBeenCalled()
  })
})
