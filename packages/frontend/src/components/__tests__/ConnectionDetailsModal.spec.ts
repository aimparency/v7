import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ConnectionDetailsModal from '../ConnectionDetailsModal.vue'
import { useDataStore } from '../../stores/data'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { nextTick } from 'vue'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
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
          aims: {
            'parent-1': {
              id: 'parent-1',
              text: 'Parent Aim',
              loopWeight: 0,
              supportingConnections: [
                { aimId: 'child-1', weight: 1, explanation: '' },
                { aimId: 'sibling-1', weight: 1 }
              ]
            },
            'child-1': {
              id: 'child-1',
              text: 'Child Aim'
            },
            'sibling-1': {
              id: 'sibling-1',
              text: 'Sibling Aim'
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

  it('saves and closes when pressing Enter key on window (if not in textarea)', async () => {
    const wrapper = mount(ConnectionDetailsModal, {
      global: {
        plugins: [pinia]
      }
    })

    await nextTick()

    // Trigger Enter on window
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    window.dispatchEvent(event)

    await nextTick()

    expect(dataStore.updateConnectionDetails).toHaveBeenCalledWith(
      expect.any(String),
      'parent-1',
      'child-1',
      expect.objectContaining({ weight: expect.any(Number), explanation: '' })
    )
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

    // It should NOT have called replaceAim or closeConnectionDetailsModal
    expect(dataStore.replaceAim).not.toHaveBeenCalled()
    expect(modalStore.closeConnectionDetailsModal).not.toHaveBeenCalled()

    wrapper.unmount()
    div.remove()
  })
})
