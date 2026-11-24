import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import IdeaRemovalDialog from '../IdeaRemovalDialog.vue'
import { useUIModalStore } from '../../stores/ui/modal-store'
import { useDataStore } from '../../stores/data'

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

  it('says which ideas gain the value of what it deletes', () => {
    const idea = (id: string, text: string, partial: Record<string, unknown> = {}) => ({
      id, text, intrinsicValue: 0, cost: 1, duration: 1, costVariance: 0, valueVariance: 0, selfWeight: 0, archived: false, tags: [], committedIn: [],
      status: { state: 'open', comment: '', date: 0 }, supportingConnections: [], supportedIdeas: ['root'], ...partial
    })
    useDataStore().ideas = {
      root: idea('root', 'Cook every Friday', { intrinsicValue: 10, supportedIdeas: [], supportingConnections: [{ ideaId: 'idea', weight: 1 }, { ideaId: 'pot', weight: 1 }] }),
      idea: idea('idea', 'Martina'),
      pot: idea('pot', 'Buy a big pot')
    } as never
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('Its value goes to: Buy a big pot')
    wrapper.unmount()
  })

  it('answers with r, x and Escape and keeps every key from list and space handlers', () => {
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
