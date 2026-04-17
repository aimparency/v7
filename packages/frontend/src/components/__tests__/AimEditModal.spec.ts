import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimEditModal from '../AimEditModal.vue'
import { useDataStore } from '../../stores/data'
import { useProjectStore } from '../../stores/project-store'
import { useUIModalStore } from '../../stores/ui/modal-store'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      list: { query: vi.fn().mockResolvedValue([]) }
    },
    phase: {
      get: { query: vi.fn().mockResolvedValue(null) }
    }
  }
}))

function mountEditModal() {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      'ui-project': {
        projectPath: '/test/project'
      },
      data: {
        aims: {
          'aim-1': {
            id: 'aim-1',
            text: 'Old title',
            description: 'Old description',
            tags: [],
            status: { state: 'open', comment: '' },
            intrinsicValue: 0,
            cost: 1,
            loopWeight: 1,
            reflection: '',
            supportedAims: [],
            supportingConnections: [],
            incoming: [],
            committedIn: []
          }
        },
        meta: {
          statuses: [{ key: 'open', color: '#fff' }, { key: 'done', color: '#0f0' }]
        }
      }
    }
  })

  const wrapper = mount(AimEditModal, {
    props: {
      show: false,
      aimId: 'aim-1'
    },
    global: {
      plugins: [pinia]
    }
  })

  const dataStore = useDataStore(pinia)
  const projectStore = useProjectStore(pinia)
  dataStore.aims['aim-1'] = {
    id: 'aim-1',
    text: 'Old title',
    description: 'Old description',
    tags: [],
    status: { state: 'open', comment: '', date: Date.now() },
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 1,
    reflection: '',
    supportedAims: [],
    supportingConnections: [],
    committedIn: []
  } as any
  projectStore.projectPath = '/test/project'

  return { wrapper, dataStore }
}

describe('AimEditModal keyboard save behavior', () => {
  it('saves and closes on Enter from title input', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const title = wrapper.find('input[placeholder=\"Aim title...\"]')
    await title.setValue('Updated title')
    await title.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not save on Enter in textarea, but saves on Ctrl+Enter', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const description = wrapper.find('textarea[placeholder=\"Optional description...\"]')
    await description.setValue('Line one')
    await description.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeFalsy()

    await description.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('adds selected parent aims from search callback to the supports list', async () => {
    const { wrapper } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const modalStore = useUIModalStore()

    await wrapper.find('button[title="Add supported aim"]').trigger('click')

    expect(modalStore.openAimSearch).toHaveBeenCalledWith(
      'pick',
      expect.any(Function),
      undefined,
      expect.objectContaining({
        title: 'Select Supported Aim',
        placeholder: 'Search for a parent aim...'
      })
    )
    const calls = vi.mocked(modalStore.openAimSearch).mock.calls
    expect(calls[0]).toBeDefined()
    expect(calls[0]![1]).toEqual(expect.any(Function))

    const callback = calls[0]![1] as (payload: any) => void
    callback({
      type: 'aim',
      data: {
        id: 'parent-1',
        text: 'Parent Aim',
        status: { state: 'open', comment: '' }
      }
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Parent Aim')
  })

  it('closes on Escape from the title input', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const title = wrapper.find('input[placeholder="Aim title..."]')
    await title.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('closes on Escape from the status select', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const status = wrapper.find('select')
    await status.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('saves on Enter from the modal content root when no field handles it', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
