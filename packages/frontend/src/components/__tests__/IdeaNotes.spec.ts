import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import IdeaNotes from '../IdeaNotes.vue'
import NotesInbox from '../NotesInbox.vue'
import { useViewerStore } from '../../stores/viewer'

const { notes, accounts } = vi.hoisted(() => ({
  notes: { list: { query: vi.fn() }, add: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, recent: { query: vi.fn() } },
  accounts: { on: true }
}))
vi.mock('../../trpc', () => ({ trpc: { notes } }))
vi.mock('../../utils/runtime-config', () => ({ hasAccounts: () => accounts.on }))

const note = (values: object) => ({ id: 'n1', ideaId: 'i1', kind: 'note', text: 'Could it serve breakfast?', author: 'ben', createdAt: new Date().toISOString(), removable: false, ...values })

const pinia = (viewer: object = {}) => createTestingPinia({
  createSpy: vi.fn,
  initialState: { project: { projectPath: 'hack-the-hub' }, viewer: { name: 'cleo', signUp: { open: false, browserKey: false }, ...viewer } }
})

const mountNotes = async (viewer?: object) => {
  const wrapper = mount(IdeaNotes, { props: { ideaId: 'i1' }, global: { plugins: [pinia(viewer)] } })
  await flushPromises()
  return wrapper
}

describe('IdeaNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accounts.on = true
    notes.list.query.mockResolvedValue({ notes: [note({}), note({ id: 'n2', kind: 'interest', text: '', removable: true })], mayAdd: true })
  })

  it('shows the notes on the idea and lets their author remove one', async () => {
    const wrapper = await mountNotes()
    expect(notes.list.query).toHaveBeenCalledWith({ projectPath: 'hack-the-hub', ideaId: 'i1' })
    expect(wrapper.findAll('.note').map(entry => entry.find('p').text())).toEqual(['Could it serve breakfast?', 'would like to work on this'])
    expect(wrapper.findAll('.remove')).toHaveLength(1)

    notes.remove.mutate.mockResolvedValue({ success: true })
    await wrapper.find('.remove').trigger('click')
    await flushPromises()
    expect(notes.remove.mutate).toHaveBeenCalledWith({ projectPath: 'hack-the-hub', id: 'n2' })
    expect(wrapper.findAll('.note')).toHaveLength(1)
  })

  it('adds a note or an interest, getting the visitor an account first', async () => {
    const wrapper = await mountNotes({ name: null, signUp: { open: false, browserKey: true } })
    const ensureAccount = vi.mocked(useViewerStore().ensureAccount).mockResolvedValueOnce(false).mockResolvedValue(true)
    await wrapper.find('textarea').setValue('I know a carpenter')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(notes.add.mutate).not.toHaveBeenCalled()

    notes.add.mutate.mockResolvedValueOnce(note({ id: 'n3', text: 'I know a carpenter', author: 'guest-1a2b3c', removable: true }))
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(ensureAccount).toHaveBeenCalledTimes(2)
    expect(notes.add.mutate).toHaveBeenCalledWith({ projectPath: 'hack-the-hub', ideaId: 'i1', kind: 'note', text: 'I know a carpenter' })
    expect(wrapper.findAll('.note')).toHaveLength(3)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')

    notes.add.mutate.mockResolvedValueOnce(note({ id: 'n4', kind: 'interest', text: '' }))
    await wrapper.find('button[type=button]').trigger('click')
    await flushPromises()
    expect(notes.add.mutate).toHaveBeenLastCalledWith({ projectPath: 'hack-the-hub', ideaId: 'i1', kind: 'interest', text: '' })
  })

  it('offers no form where the owner closed the graph for notes, and nothing at all without accounts', async () => {
    notes.list.query.mockResolvedValue({ notes: [], mayAdd: false })
    const closed = await mountNotes()
    expect(closed.find('form').exists()).toBe(false)
    expect(closed.text()).toContain('None yet.')

    accounts.on = false
    notes.list.query.mockClear()
    const local = await mountNotes()
    expect(local.find('.idea-notes').exists()).toBe(false)
    expect(notes.list.query).not.toHaveBeenCalled()
  })
})

describe('NotesInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  const mountInbox = async (viewer?: object) => {
    const wrapper = mount(NotesInbox, { global: { plugins: [pinia(viewer)], stubs: { teleport: true } }, attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  it('counts the notes that came since the list was last opened and opens a note\'s idea', async () => {
    notes.recent.query.mockResolvedValue([note({ slug: 'hack-the-hub', ideaText: 'A shared kitchen' })])
    const wrapper = await mountInbox()
    expect(wrapper.find('.inbox-btn').text()).toBe('1')
    expect(wrapper.find('.inbox-btn').classes()).toContain('unseen')

    await wrapper.find('.inbox-btn').trigger('click')
    expect(wrapper.find('.inbox-btn').text()).toBe('')
    expect(wrapper.find('.entry .where').text()).toBe('hack-the-hub · A shared kitchen')
    await wrapper.find('.entry').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['hack-the-hub', 'i1']])
  })

  it('stays away for visitors and for accounts without notes', async () => {
    notes.recent.query.mockResolvedValue([])
    expect((await mountInbox()).find('.inbox-btn').exists()).toBe(false)
    notes.recent.query.mockClear()
    expect((await mountInbox({ name: null })).find('.inbox-btn').exists()).toBe(false)
    expect(notes.recent.query).not.toHaveBeenCalled()
  })
})
