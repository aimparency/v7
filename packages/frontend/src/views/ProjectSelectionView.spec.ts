import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectSelectionView from './ProjectSelectionView.vue'

const { inspectPath } = vi.hoisted(() => ({ inspectPath: vi.fn() }))
vi.mock('../trpc', () => ({
  trpc: { project: { inspectPath: { query: inspectPath } } },
}))
vi.mock('../utils/db', () => ({ loadProjectThumbnails: async () => new Map() }))

const history = ['/work/aimparency/v7', '/work/entour', '/work/aimparency/v6']
  .map((path, index) => ({ path, lastOpened: index, failedToLoad: false }))
const discovered = [{ path: '/work/notes', bowmanPath: '/work/notes/.bowman', sourceRoot: '/work' }]

const mountView = (modelValue: string, lists = false) => mount(ProjectSelectionView, {
  attachTo: document.body,
  props: {
    modelValue,
    projectHistory: lists ? history : [],
    discoveredProjects: lists ? discovered : [],
    scannedRoots: [],
    isRefreshingDiscoveredProjects: false,
    isOpeningGitUrl: false,
  },
})

describe('ProjectSelectionView project kind', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    inspectPath.mockReset()
  })

  it('labels paths with an existing .bowman as Open Project', async () => {
    inspectPath.mockResolvedValue({ bowmanExists: true, matches: [] })
    const wrapper = mountView('/work/existing')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('Open Project')
  })

  it('offers to open a Git URL read-only without inspecting it as a folder', async () => {
    const wrapper = mountView('https://github.com/aimparency/v7.git')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('Open read-only')
    expect(inspectPath).not.toHaveBeenCalled()
  })

  it('labels paths without a .bowman as New Project', async () => {
    inspectPath.mockResolvedValue({ bowmanExists: false, matches: [] })
    const wrapper = mountView('/work/fresh')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('New Project')
  })

  it('shows the common folder completion and accepts it with Tab', async () => {
    inspectPath.mockResolvedValue({
      bowmanExists: false,
      matches: ['/work/projects-alpha', '/work/projects-beta'],
    })
    const wrapper = mountView('/work/pro')
    await vi.advanceTimersByTimeAsync(200)

    expect(wrapper.find('.path-completion').text()).toContain('jects-')
    await wrapper.find('input').trigger('keydown', { key: 'Tab' })
    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates[updates.length - 1]).toEqual(['/work/projects-'])
  })
})

describe('ProjectSelectionView search', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    inspectPath.mockReset()
    inspectPath.mockResolvedValue({ bowmanExists: true, matches: [] })
  })

  const paths = (wrapper: ReturnType<typeof mountView>) => wrapper.findAll('.history-path').map(path => path.text())

  it('filters both lists by the input and shows no number shortcuts', () => {
    expect(paths(mountView('', true))).toEqual([...history.map(entry => entry.path), '/work/notes'])
    expect(paths(mountView('aimparency', true))).toEqual(['/work/aimparency/v7', '/work/aimparency/v6'])
    expect(mountView('', true).find('.history-shortcut').exists()).toBe(false)
  })

  it('highlights a perfect folder-name match and opens it with Enter', async () => {
    const wrapper = mountView('entour', true)
    expect(wrapper.find('.history-item.selected .history-path').text()).toBe('/work/entour')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('open-project-from-history')).toEqual([['/work/entour']])
    expect(wrapper.emitted('select-project')).toBeUndefined()
  })

  it('opens what was typed when nothing matches perfectly', async () => {
    const wrapper = mountView('aimparency', true)
    expect(wrapper.find('.history-item.selected').exists()).toBe(false)
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select-project')).toHaveLength(1)
  })

  it('moves into the list with Tab and navigates with j and k', async () => {
    const wrapper = mountView('', true)
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.find('input').trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()
    const selected = () => wrapper.find('.history-item.selected .history-path').text()
    expect(selected()).toBe('/work/aimparency/v7')
    const list = wrapper.find('.project-lists')
    await list.trigger('keydown', { key: 'j' })
    await list.trigger('keydown', { key: 'j' })
    await list.trigger('keydown', { key: 'j' })
    expect(selected()).toBe('/work/notes')
    await list.trigger('keydown', { key: 'k' })
    expect(selected()).toBe('/work/aimparency/v6')
    wrapper.unmount()
  })

  it('steps entry to entry with Tab, back to the input with Shift+Tab, and e edits the path', async () => {
    const wrapper = mountView('', true)
    await vi.advanceTimersByTimeAsync(200)
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()
    const list = wrapper.find('.project-lists')
    const selected = () => wrapper.find('.history-item.selected .history-path').text()
    await list.trigger('keydown', { key: 'Tab' })
    expect(selected()).toBe('/work/entour')
    await list.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(selected()).toBe('/work/aimparency/v7')
    await list.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(input.element)
    await input.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()
    await list.trigger('keydown', { key: 'e' })
    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates[updates.length - 1]).toEqual(['/work/aimparency/v7'])
    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })

  it('removes a recent project with d, d: the first d only marks it red', async () => {
    const wrapper = mountView('', true)
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.find('input').trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()
    const list = wrapper.find('.project-lists')
    await list.trigger('keydown', { key: 'd' })
    expect(wrapper.find('.history-item.removing .history-path').text()).toBe('/work/aimparency/v7')
    expect(wrapper.emitted('remove-from-history')).toBeUndefined()
    await list.trigger('keydown', { key: 'j' })
    expect(wrapper.find('.history-item.removing').exists()).toBe(false)
    await list.trigger('keydown', { key: 'd' })
    await list.trigger('keydown', { key: 'd' })
    expect(wrapper.emitted('remove-from-history')).toEqual([['/work/entour']])
    wrapper.unmount()
  })

  it('keeps the edit and remove buttons out of the Tab order', () => {
    const wrapper = mountView('', true)
    expect(wrapper.findAll('.edit-button, .remove-button').every(button => button.attributes('tabindex') === '-1')).toBe(true)
  })
})
