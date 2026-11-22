import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import HookControl from '../HookControl.vue'
import HookLoopsModal from '../HookLoopsModal.vue'

const defaultLoop = { slug: 'default', title: 'Default', work: 'Continue with the graph.', human: 'Challenge first.' }
const refactor = { slug: 'refactor', title: 'Refactor', work: 'Tidy one module.', human: '' }

const { get, select, saveLoop, deleteLoop } = vi.hoisted(() => ({
  get: vi.fn(),
  select: vi.fn(),
  saveLoop: vi.fn(),
  deleteLoop: vi.fn()
}))
vi.mock('../../trpc', () => ({
  trpc: { continueHook: { get: { query: get }, select: { mutate: select }, saveLoop: { mutate: saveLoop }, deleteLoop: { mutate: deleteLoop } } }
}))

const global = {
  plugins: [createTestingPinia({ createSpy: vi.fn, initialState: { project: { projectPath: '/p' } } })]
}
const menuItems = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.menu-item').map(item => item.text())

describe('HookControl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers Off, every loop and Manage; picking a loop turns the hook on with it', async () => {
    get.mockResolvedValue({ installed: true, enabled: false, loop: null, loops: [defaultLoop, refactor] })
    select.mockResolvedValue({ installed: true, enabled: true, loop: 'refactor', loops: [defaultLoop, refactor] })
    const wrapper = mount(HookControl, { global, attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('button').text()).toBe('Hook off')

    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(menuItems(wrapper)).toEqual(['Off', 'Default', 'Refactor', 'Manage loops…'])

    await wrapper.findAll('.menu-item')[2]!.trigger('click')
    await flushPromises()
    expect(select).toHaveBeenCalledWith({ graph: '/p', loop: 'refactor', agent: undefined })
    expect(wrapper.find('button').text()).toBe('Hook: Refactor')
    wrapper.unmount()
  })

  it('without the hook in the repository it offers to install it for an agent', async () => {
    get.mockResolvedValue({ installed: false, enabled: false, loop: null, loops: [defaultLoop] })
    select.mockResolvedValue({ installed: true, enabled: true, loop: null, loops: [defaultLoop] })
    const wrapper = mount(HookControl, { global, attachTo: document.body })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(menuItems(wrapper)).toEqual(['Off', 'Claude Code', 'Codex', 'Antigravity', 'Manage loops…'])

    await wrapper.findAll('.menu-item')[1]!.trigger('click')
    await flushPromises()
    expect(select).toHaveBeenCalledWith({ graph: '/p', loop: 'default', agent: 'claude' })
    expect(wrapper.find('button').text()).toBe('Hook: Default')
    wrapper.unmount()
  })
})

describe('HookLoopsModal', () => {
  beforeEach(() => vi.clearAllMocks())
  const state = { installed: true, enabled: true, loop: 'refactor', loops: [defaultLoop, refactor] }

  it('saves the default only as a new loop', async () => {
    saveLoop.mockResolvedValue({ ...state, loops: [defaultLoop, refactor, { ...defaultLoop, slug: 'ideation', title: 'Ideation' }], saved: 'ideation' })
    const wrapper = mount(HookLoopsModal, { props: { state }, global })
    await wrapper.findAll('.loop-list button')[0]!.trigger('click')
    expect(wrapper.find('.btn-danger').exists()).toBe(false)
    await wrapper.find('input').setValue('Ideation')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(saveLoop).toHaveBeenCalledWith({ graph: '/p', slug: undefined, title: 'Ideation', work: defaultLoop.work, human: defaultLoop.human })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('Ideation')
  })

  it('opens the running loop; Reset to default loads the default text into it, Save writes it', async () => {
    saveLoop.mockResolvedValue({ ...state, saved: 'refactor' })
    const wrapper = mount(HookLoopsModal, { props: { state }, global })
    const textareas = () => wrapper.findAll('textarea').map(area => (area.element as HTMLTextAreaElement).value)
    expect(textareas()).toEqual(['Tidy one module.', ''])
    expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined() // nothing changed

    await wrapper.findAll('.btn-secondary').find(button => button.text() === 'Reset to default')!.trigger('click')
    expect(textareas()).toEqual([defaultLoop.work, defaultLoop.human])
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(saveLoop).toHaveBeenCalledWith({ graph: '/p', slug: 'refactor', title: 'Refactor', work: defaultLoop.work, human: defaultLoop.human })
  })

  it('Escape or the close button closes it; with unsaved edits it asks first, Escape again keeps editing', async () => {
    const wrapper = mount(HookLoopsModal, { props: { state }, global, attachTo: document.body })
    const escape = (target = wrapper.find('textarea')) => target.trigger('keydown', { key: 'Escape' })

    await escape()
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.find('button[title="Close (Esc)"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)

    await wrapper.find('textarea').setValue('Changed.')
    await escape()
    expect(wrapper.emitted('close')).toHaveLength(2)
    expect(wrapper.find('.discard-prompt').exists()).toBe(true)
    await escape()
    expect(wrapper.find('.discard-prompt').exists()).toBe(false)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Changed.')

    await escape()
    await wrapper.find('.btn-discard').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(3)
    wrapper.unmount()
  })
})
