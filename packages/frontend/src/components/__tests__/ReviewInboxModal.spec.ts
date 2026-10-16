import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createTestingPinia } from '@pinia/testing'
import ReviewInboxModal from '../ReviewInboxModal.vue'
import { useDataStore } from '../../stores/data'
import { useUIModalStore } from '../../stores/ui/modal-store'

vi.mock('../../trpc', () => ({ trpc: {} }))

const idea = (id: string, state: string, comment = '') =>
  ({ id, text: id, archived: false, status: { state, comment, date: 1 } })

describe('ReviewInboxModal', () => {
  let dataStore: any
  let modalStore: any

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn() // not implemented by jsdom
    createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        project: { projectPath: '/p' },
        data: {
          ideas: {
            done: idea('done', 'review', 'tests pass'),
            blocked: idea('blocked', 'human-dependent', 'needs a login'),
            open: idea('open', 'open'),
            question: idea('question', 'unclear')
          },
          phases: {
            plan: { id: 'plan', name: 'plan', parent: null, commitments: ['done', 'blocked'], childPhaseIds: [] }
          },
          meta: { rootPhaseIds: ['plan'] }
        }
      }
    })
    dataStore = useDataStore()
    dataStore.calculatedPriorities = new Map([['done', 1], ['blocked', 2], ['open', 5]])
    modalStore = useUIModalStore()
  })

  const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

  it('lists what waits on the human by priority and accepts reviewed work with its evidence', async () => {
    const wrapper = mount(ReviewInboxModal, { attachTo: document.body })

    expect(wrapper.findAll('li .text').map(item => item.text())).toEqual(['blocked', 'done'])

    press('a') // human-dependent: nothing to accept
    expect(dataStore.updateIdea).not.toHaveBeenCalled()

    press('j')
    press('a')
    expect(dataStore.updateIdea).toHaveBeenCalledWith('/p', 'done', {
      status: { state: 'implemented', comment: 'tests pass', date: 1 }
    })
    wrapper.unmount()
  })

  it('sends work back to open with a reason and opens ideas in the editor', async () => {
    const wrapper = mount(ReviewInboxModal, { attachTo: document.body })

    press('e')
    expect(modalStore.openIdeaEditModal).toHaveBeenCalledWith('blocked')

    press('j')
    press('s')
    await nextTick()
    await wrapper.find('.send-back input').setValue('missing screenshot')
    await wrapper.find('.send-back').trigger('submit')
    expect(dataStore.updateIdea).toHaveBeenCalledWith('/p', 'done', {
      status: { state: 'open', comment: 'missing screenshot', date: 1 }
    })
    wrapper.unmount()
  })

  it('toggles states (unclear is off by default) and orders by first appearance in the phases', async () => {
    const wrapper = mount(ReviewInboxModal, { attachTo: document.body })
    const texts = () => wrapper.findAll('li .text').map(item => item.text())
    const button = (label: string) => wrapper.findAll('.filters button').find(item => item.text().startsWith(label))!

    await button('unclear').trigger('click')
    expect(texts()).toEqual(['blocked', 'done', 'question'])

    await button('human-dependent').trigger('click')
    expect(texts()).toEqual(['done', 'question'])

    await button('human-dependent').trigger('click')
    await button('chronological').trigger('click')
    expect(texts()).toEqual(['done', 'blocked', 'question'])
    wrapper.unmount()
  })
})
