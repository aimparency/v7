import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import PhaseCreationModal from '../PhaseCreationModal.vue'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { useDataStore } from '../../stores/data'
import { trpc } from '../../trpc'

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

  return { wrapper, modalStore, dataStore: useDataStore(pinia) }
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

  it('closes from the phase name input on Escape', async () => {
    const { wrapper, modalStore } = mountPhaseModal()

    await wrapper.find('input[placeholder="Enter phase name"]').trigger('keydown', { key: 'Escape' })

    expect(modalStore.closePhaseModal).toHaveBeenCalledTimes(1)
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

describe('PhaseCreationModal keys: Space edits, Enter confirms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mountEditModal = async () => {
    const mounted = mountPhaseModal()
    mounted.modalStore.phaseModalMode = 'edit'
    mounted.modalStore.phaseModalEditingPhaseId = 'phase-1'
    mounted.modalStore.phaseModalEditingParentId = 'parent-1'
    await mounted.wrapper.vm.$nextTick()
    return mounted
  }

  it('updates the phase on Enter in the name input', async () => {
    const { wrapper } = await mountEditModal()

    await wrapper.find('input[placeholder="Enter phase name"]').trigger('keydown', { key: 'Enter' })

    expect(trpc.phase.update.mutate).toHaveBeenCalledOnce()
  })

  it('confirms on Enter on the parent picker, opens the search on Space', async () => {
    const { wrapper } = await mountEditModal()
    const picker = wrapper.find('.parent-selector')

    await picker.trigger('keydown', { key: 'Enter' })
    expect(trpc.phase.update.mutate).toHaveBeenCalledOnce()
    expect(wrapper.findComponent({ name: 'PhaseSearchModal' }).exists()).toBe(false)

    await picker.trigger('keydown', { key: ' ' })
    expect(wrapper.findComponent({ name: 'PhaseSearchModal' }).exists()).toBe(true)
  })
})

describe('PhaseCreationModal creates a phase once per submission', () => {
  it('ignores Enter while the first creation is still in flight, then accepts the next one', async () => {
    const { wrapper, dataStore } = mountPhaseModal()
    let finish!: () => void
    vi.mocked(dataStore.createAndSelectPhase).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }) as any)
    const input = wrapper.find('input[placeholder="Enter phase name"]')

    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(dataStore.createAndSelectPhase).toHaveBeenCalledOnce()

    finish()
    await flushPromises()
    await input.trigger('keydown', { key: 'Enter' })
    expect(dataStore.createAndSelectPhase).toHaveBeenCalledTimes(2)
  })
})
