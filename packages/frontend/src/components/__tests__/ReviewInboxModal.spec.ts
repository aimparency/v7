import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createTestingPinia } from '@pinia/testing'
import ReviewInboxModal from '../ReviewInboxModal.vue'
import { useDataStore } from '../../stores/data'
import { useUIModalStore } from '../../stores/ui/modal-store'

vi.mock('../../trpc', () => ({ trpc: {} }))

const idea = (id: string, state: string, comment = '', children: string[] = []) =>
  ({ id, text: id, archived: false, status: { state, comment, date: 1 }, supportingConnections: children.map(ideaId => ({ ideaId })), supportedIdeas: [] })

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
            question: idea('question', 'unclear', 'Which one?', ['yes']),
            yes: { ...idea('yes', 'ai-proposition'), supportedIdeas: ['question'] }
          },
          phases: {
            plan: { id: 'plan', name: 'plan', parent: null, commitments: ['done', 'blocked'], childPhaseIds: [] }
          },
          meta: { rootPhaseIds: ['plan'] }
        }
      }
    })
    dataStore = useDataStore()
    dataStore.calculatedPriorities = new Map([['done', 1], ['blocked', 2], ['open', 5], ['question', 0.5]])
    modalStore = useUIModalStore()
  })

  const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  const title = (wrapper: any) => wrapper.find('.card h3').text()
  const options = (wrapper: any) => wrapper.findAll('.options li').map((item: any) => item.text())

  it('shows one idea at a time; a number decides, Space puts it off', async () => {
    const wrapper = mount(ReviewInboxModal, { attachTo: document.body })

    expect(title(wrapper)).toBe('blocked')
    expect(options(wrapper)).toEqual(['1 Done, I did it', '2 Answer…', '3 Drop'])

    press(' ')
    await nextTick()
    expect(title(wrapper)).toBe('done')
    press('1')
    expect(dataStore.updateIdea).toHaveBeenCalledWith('/p', 'done', { status: { state: 'implemented', comment: 'tests pass', date: 1 } })

    press(' ')
    await nextTick()
    expect(title(wrapper)).toBe('question')
    expect(options(wrapper)[0]).toBe('1 yes')
    press(' ')
    await nextTick()
    expect(wrapper.find('.finished').exists()).toBe(true)
    wrapper.unmount()
  })

  it('takes a written answer, undoes it, and opens ideas in the editor', async () => {
    const wrapper = mount(ReviewInboxModal, { attachTo: document.body })

    press('e')
    expect(modalStore.openIdeaEditModal).toHaveBeenCalledWith('blocked')

    press('2')
    await nextTick()
    await nextTick()
    await wrapper.find('.reply textarea').setValue('logged in')
    press('1') // typing: numbers don't decide
    press('Enter')
    await nextTick()
    expect(dataStore.updateIdea).toHaveBeenCalledTimes(1)
    expect(dataStore.updateIdea).toHaveBeenCalledWith('/p', 'blocked', { status: { state: 'open', comment: 'Answer: logged in\n\nneeds a login', date: 1 } })

    await new Promise(resolve => setTimeout(resolve))
    press('u')
    await new Promise(resolve => setTimeout(resolve))
    expect(dataStore.updateIdea).toHaveBeenLastCalledWith('/p', 'blocked', { status: { state: 'human-dependent', comment: 'needs a login', date: 1 } })
    wrapper.unmount()
  })

  it('lists them all, filtered by state and ordered by first appearance in the phases', async () => {
    const wrapper = mount(ReviewInboxModal, { attachTo: document.body })
    press('Tab')
    await nextTick()
    const texts = () => wrapper.findAll('.list li .text').map(item => item.text())
    const button = (label: string) => wrapper.findAll('.filters button').find(item => item.text().startsWith(label))!

    expect(texts()).toEqual(['blocked', 'done', 'question'])

    await button('human-dependent').trigger('click')
    expect(texts()).toEqual(['done', 'question'])

    await button('human-dependent').trigger('click')
    await button('by plan').trigger('click')
    expect(texts()).toEqual(['done', 'blocked', 'question'])

    press('j')
    press('Enter')
    await nextTick()
    expect(title(wrapper)).toBe('blocked')
    wrapper.unmount()
  })
})
