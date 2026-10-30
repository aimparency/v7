import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ConnectionDetailsModal from '../ConnectionDetailsModal.vue'
import { useDataStore } from '../../stores/data'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { nextTick } from 'vue'

vi.mock('../../trpc', () => ({
  trpc: {
    idea: {
      update: { mutate: vi.fn().mockResolvedValue({}) }
    }
  }
}))

describe('ConnectionDetailsModal', () => {
  let pinia: any
  let dataStore: any
  let modalStore: any

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-project': {
          projectPath: '/test/project'
        },
        'ui-modal': {
          showConnectionDetailsModal: true,
          connectionDetailsParentId: 'parent-1',
          connectionDetailsChildId: 'child-1'
        },
        data: {
          ideas: {
            'parent-1': {
              id: 'parent-1',
              text: 'Parent Idea',
              selfWeight: 0,
              supportingConnections: [
                { ideaId: 'child-1', weight: 1, hypothesis: '' },
                { ideaId: 'sibling-1', weight: 1 }
              ]
            },
            'child-1': {
              id: 'child-1',
              text: 'Child Idea'
            },
            'sibling-1': {
              id: 'sibling-1',
              text: 'Sibling Idea'
            }
          }
        }
      }
    })
    dataStore = useDataStore(pinia)
    modalStore = useUIModalStore(pinia)
  })

  it('focuses and selects the percentage input initially on mount', async () => {
    // Mount attached to document body so activeElement works
    const div = document.createElement('div')
    document.body.appendChild(div)

    const wrapper = mount(ConnectionDetailsModal, {
      global: {
        plugins: [pinia]
      },
      attachTo: div
    })

    await nextTick()
    await nextTick() // double nextTick to ensure onMounted nextTick ran

    const input = wrapper.find('input[type="number"]')
    expect(input.exists()).toBe(true)

    // Check if the input is focused
    expect(document.activeElement).toBe(input.element)

    wrapper.unmount()
    div.remove()
  })

  it('saves and closes on Enter in the weight input', async () => {
    const wrapper = mount(ConnectionDetailsModal, {
      global: {
        plugins: [pinia]
      }
    })

    await nextTick()
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(dataStore.updateConnectionDetails).toHaveBeenCalledWith(
      expect.any(String),
      'parent-1',
      'child-1',
      { weight: expect.any(Number), hypothesis: undefined, reflection: undefined }
    )
    expect(modalStore.closeConnectionDetailsModal).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('saves on Ctrl+Enter in the hypothesis textarea', async () => {
    const wrapper = mount(ConnectionDetailsModal, { global: { plugins: [pinia] } })
    await nextTick()

    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })

    expect(modalStore.closeConnectionDetailsModal).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not save or close when pressing Enter key while focused on a textarea', async () => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    const wrapper = mount(ConnectionDetailsModal, {
      global: {
        plugins: [pinia]
      },
      attachTo: div
    })

    await nextTick()

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)

    // Focus on textarea
    ;(textarea.element as HTMLElement).focus()
    expect(document.activeElement).toBe(textarea.element)

    // Trigger Enter on the textarea
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    textarea.element.dispatchEvent(event)

    await nextTick()

    // It should NOT have saved or closed
    expect(dataStore.updateConnectionDetails).not.toHaveBeenCalled()
    expect(modalStore.closeConnectionDetailsModal).not.toHaveBeenCalled()

    wrapper.unmount()
    div.remove()
  })

  it('hides the reflection field until the connection is being reflected on', () => {
    const wrapper = mount(ConnectionDetailsModal, { global: { plugins: [pinia] } })
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    wrapper.unmount()
  })

  it('in reflection mode focuses the reflection and saves it with the hypothesis', async () => {
    modalStore.connectionDetailsReflect = true
    dataStore.ideas['parent-1'].supportingConnections[0].hypothesis = 'should speed things up'
    const div = document.createElement('div')
    document.body.appendChild(div)
    const wrapper = mount(ConnectionDetailsModal, { global: { plugins: [pinia] }, attachTo: div })
    await nextTick()
    await nextTick()

    const [hypothesis, reflection] = wrapper.findAll('textarea')
    expect((hypothesis!.element as HTMLTextAreaElement).value).toBe('should speed things up')
    expect(document.activeElement).toBe(reflection!.element)

    await reflection!.setValue('  it did, mostly  ')
    await wrapper.findAll('button').find((button) => button.text() === 'Save')!.trigger('click')

    expect(dataStore.updateConnectionDetails).toHaveBeenCalledWith(
      expect.any(String),
      'parent-1',
      'child-1',
      { weight: expect.any(Number), hypothesis: 'should speed things up', reflection: 'it did, mostly' }
    )
    wrapper.unmount()
    div.remove()
  })

  it('asks before Escape in the reflection textarea drops the written reflection', async () => {
    modalStore.connectionDetailsReflect = true
    const div = document.createElement('div')
    document.body.appendChild(div)
    const wrapper = mount(ConnectionDetailsModal, { global: { plugins: [pinia] }, attachTo: div })
    await nextTick()

    const reflection = wrapper.findAll('textarea')[1]!
    await reflection.setValue('it held')
    await reflection.trigger('keydown', { key: 'Escape' })

    expect(modalStore.closeConnectionDetailsModal).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.find('.btn-discard').element)

    // A second Escape returns to the reflection with the text intact.
    await wrapper.find('.btn-discard').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.btn-discard').exists()).toBe(false)
    expect((reflection.element as HTMLTextAreaElement).value).toBe('it held')

    await reflection.trigger('keydown', { key: 'Escape' })
    await wrapper.find('.btn-discard').trigger('click')
    expect(modalStore.closeConnectionDetailsModal).toHaveBeenCalled()
    expect(dataStore.updateConnectionDetails).not.toHaveBeenCalled()
    wrapper.unmount()
    div.remove()
  })

  it('closes on Escape without asking when nothing was edited', async () => {
    const wrapper = mount(ConnectionDetailsModal, { global: { plugins: [pinia] } })
    await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(modalStore.closeConnectionDetailsModal).toHaveBeenCalled()
    wrapper.unmount()
  })
})
