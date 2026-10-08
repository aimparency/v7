import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import IdeaRemovalDialog from '../IdeaRemovalDialog.vue'
import { useUIModalStore } from '../../stores/ui/modal-store'

vi.mock('../../trpc', () => ({ trpc: {} }))

describe('IdeaRemovalDialog', () => {
  let modalStore: any

  beforeEach(() => {
    createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        data: {
          ideas: {
            idea: { id: 'idea', text: 'Martina' },
            child: { id: 'child', text: 'Ideen mit Martina besprechen' }
          }
        }
      }
    })
    modalStore = useUIModalStore()
  })

  const mountDialog = (fromLabel?: string) => mount(IdeaRemovalDialog, {
    props: { request: { ideaIds: ['idea'], fromLabel, cascadeIds: ['idea', 'child'] } },
    attachTo: document.body
  })

  it('names the list it removes from and lists what the subtree delete takes', () => {
    const wrapper = mountDialog('Gitarre spielen')

    expect(wrapper.text()).toContain('Remove from “Gitarre spielen”, keep it floating')
    expect(wrapper.text()).toContain('Delete “Martina” and 1 sub-idea nothing else holds')
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['Martina', 'Ideen mit Martina besprechen'])
    wrapper.unmount()
  })

  it('answers with r, x and Escape and keeps every key from list and graph handlers', () => {
    const wrapper = mountDialog()
    const reachedWindow = vi.fn()
    window.addEventListener('keydown', reachedWindow)

    for (const key of ['d', 'r', 'x', 'Escape']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

    expect(modalStore.answerIdeaRemoval.mock.calls).toEqual([['keep'], ['cascade'], [null]])
    expect(reachedWindow).not.toHaveBeenCalled()
    window.removeEventListener('keydown', reachedWindow)
    wrapper.unmount()
  })
})
