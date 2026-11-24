import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ProjectSelectionView from './ProjectSelectionView.vue'
import { useViewerStore } from '../stores/viewer'
import { useProjectStore } from '../stores/project-store'

const { inspectPath, discoverLocalProjects, listSpaces, listDeleted, removeSpaceEntry, restoreSpace, createSpace, addRemote, addCheckout, accounts } = vi.hoisted(() => ({
  inspectPath: vi.fn(),
  discoverLocalProjects: vi.fn(),
  addRemote: vi.fn(),
  addCheckout: vi.fn(),
  listSpaces: vi.fn().mockResolvedValue([]),
  listDeleted: vi.fn().mockResolvedValue([]),
  removeSpaceEntry: vi.fn().mockResolvedValue({ success: true }),
  restoreSpace: vi.fn().mockResolvedValue({ slug: 'x' }),
  createSpace: vi.fn(),
  accounts: { on: false }
}))
vi.mock('../trpc', () => ({
  trpc: {
    project: { inspectPath: { query: inspectPath }, discoverLocalProjects: { query: discoverLocalProjects } },
    spaces: { list: { query: listSpaces }, listDeleted: { query: listDeleted }, remove: { mutate: removeSpaceEntry }, restore: { mutate: restoreSpace }, create: { mutate: createSpace }, addRemote: { mutate: addRemote }, addCheckout: { mutate: addCheckout } }
  },
}))
vi.mock('../utils/runtime-config', () => ({ hasAccounts: () => accounts.on }))
vi.mock('../utils/db', () => ({ loadProjectThumbnails: async () => new Map() }))

const history = ['/work/aimparency/v7', '/work/entour', '/work/aimparency/v6']
  .map((path, index) => ({ path, lastOpened: index, failedToLoad: false }))
const discovered = [{ path: '/work/notes', bowmanPath: '/work/notes/.bowman', sourceRoot: '/work' }]

const mountView = (modelValue: string, lists = false, viewer = {}) => mount(ProjectSelectionView, {
  attachTo: document.body,
  global: {
    plugins: [createTestingPinia({
      createSpy: vi.fn,
      initialState: { viewer: { name: null, serverAdmin: true, canCreateSpaces: true, signUp: { open: false, browserKey: false }, ...viewer } }
    })],
    stubs: { LoginControl: true }
  },
  props: {
    modelValue,
    projectHistory: lists ? history : [],
    discoveredProjects: lists ? discovered : [],
    scannedRoots: [],
    isRefreshingDiscoveredProjects: false,
  },
})

describe('ProjectSelectionView project kind', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    inspectPath.mockReset()
  })

  it('labels paths with an existing .bowman as Open space', async () => {
    inspectPath.mockResolvedValue({ bowmanExists: true, matches: [] })
    const wrapper = mountView('/work/existing')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('Open space')
  })

  it('offers to open a Git URL read-only without inspecting it as a folder', async () => {
    const wrapper = mountView('https://github.com/aimparency/v7.git')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('Open read-only')
    expect(inspectPath).not.toHaveBeenCalled()
  })

  it('labels paths without a .bowman as New space', async () => {
    inspectPath.mockResolvedValue({ bowmanExists: false, matches: [] })
    const wrapper = mountView('/work/fresh')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('New space')
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

describe('ProjectSelectionView on a server with accounts', () => {
  beforeEach(() => {
    vi.useRealTimers()
    accounts.on = true
    listSpaces.mockResolvedValue([
      { slug: 'hack-the-hub', kind: 'created', name: 'Hack the Hub', color: '#123456', owner: 'ana' },
      { slug: 'garden', kind: 'created', name: 'Garden', color: null, owner: null, right: 'owner' }
    ])
    listDeleted.mockReset().mockResolvedValue([])
    createSpace.mockReset().mockResolvedValue({ slug: 'my-idea' })
    addRemote.mockReset()
    addCheckout.mockReset()
  })
  afterEach(() => { accounts.on = false })

  const mountServer = (modelValue: string, viewer = {}, lists = false) => mountView(modelValue, lists, { name: 'ben', serverAdmin: false, ...viewer })
  const titles = (wrapper: ReturnType<typeof mountView>) => wrapper.findAll('.history-path').map(title => title.text())

  it('lists the server\'s spaces instead of this machine\'s directories and opens one by its slug', async () => {
    const wrapper = mountServer('', {}, true)
    await flushPromises()
    expect(wrapper.text()).not.toContain('/work/entour')
    expect(titles(wrapper)).toEqual(['Hack the Hub', 'Garden'])
    expect(wrapper.text()).toContain('ana · /spaces/hack-the-hub')
    await wrapper.find('.history-open-button').trigger('click')
    expect(wrapper.emitted('open-space')).toEqual([['hack-the-hub']])
  })

  it('offers no pencil for a server space: there is no path to change before opening', async () => {
    const wrapper = mountServer('', {}, true)
    await flushPromises()
    expect(wrapper.find('[aria-label="Into the box, to change before opening"]').exists()).toBe(false)
  })

  it('shows the recently opened spaces first, with the same keys as on this machine', async () => {
    const wrapper = mount(ProjectSelectionView, {
      attachTo: document.body,
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, initialState: { viewer: { name: 'ben', serverAdmin: false, canCreateSpaces: true, signUp: { open: false, browserKey: false } } } })],
        stubs: { LoginControl: true }
      },
      props: { modelValue: '', projectHistory: [{ path: 'garden', lastOpened: Date.now(), failedToLoad: false }, { path: '/work/entour', lastOpened: 0, failedToLoad: false }], discoveredProjects: [], scannedRoots: [], isRefreshingDiscoveredProjects: false }
    })
    await flushPromises()
    expect(wrapper.findAll('h3').map(title => title.text())).toEqual(['Recent spaces', 'Spaces on this server'])
    expect(titles(wrapper)).toEqual(['Garden', 'Hack the Hub'])
    await wrapper.find('input').trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()
    const list = wrapper.find('.project-lists')
    await list.trigger('keydown', { key: 'd' })
    await list.trigger('keydown', { key: 'd' })
    expect(wrapper.emitted('remove-from-history')).toEqual([['garden']])
    await list.trigger('keydown', { key: 'j' })
    expect(wrapper.find('.history-item.selected .history-path').text()).toBe('Hack the Hub')
    wrapper.unmount()
  })

  it('lets the owner delete a space, which waits under "Deleted spaces" to be restored', async () => {
    const wrapper = mountServer('')
    await flushPromises()
    expect(wrapper.findAll('h3').map(title => title.text())).toEqual(['Spaces on this server'])
    // Only the owner's space has the trash.
    expect(wrapper.findAll('.history-item').map(item => item.find('[aria-label="Delete this space"]').exists())).toEqual([false, true])

    listSpaces.mockResolvedValue([{ slug: 'hack-the-hub', kind: 'created', name: 'Hack the Hub', color: '#123456', owner: 'ana' }])
    listDeleted.mockResolvedValue([{ slug: 'garden', name: 'Garden', color: null, deletedAt: new Date().toISOString(), purgeAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }])
    await wrapper.find('[aria-label="Delete this space"]').trigger('click')
    await flushPromises()
    expect(removeSpaceEntry).toHaveBeenCalledWith({ space: 'garden' })
    expect(wrapper.findAll('h3').map(title => title.text())).toEqual(['Spaces on this server', 'Deleted spaces'])
    expect(wrapper.find('.history-item.deleted').text()).toContain('deleted for good in 30 days')

    await wrapper.find('.history-item.deleted [aria-label="Restore"]').trigger('click')
    expect(restoreSpace).toHaveBeenCalledWith({ slug: 'garden' })
    expect(wrapper.emitted('open-space')).toBeUndefined()
  })

  it('filters by name and opens a perfect match with Enter', async () => {
    const wrapper = mountServer('garden')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Garden'])
    expect(wrapper.find('.select-project').text()).toBe('Open')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('open-space')).toEqual([['garden']])
  })

  it('creates a space from a new name in the box, and opens it', async () => {
    const wrapper = mountServer('My idea')
    vi.mocked(useViewerStore().ensureAccount).mockResolvedValue(true)
    await flushPromises()
    expect(wrapper.find('.select-project').text()).toBe('New space')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(createSpace).toHaveBeenCalledWith({ name: 'My idea' })
    expect(wrapper.emitted('open-space')).toEqual([['my-idea']])
  })

  it('lets a visitor create a space where accounts are given automatically, and gets them one first', async () => {
    const wrapper = mountServer('My idea', { name: null, canCreateSpaces: false, signUp: { open: false, browserKey: true } })
    const ensureAccount = vi.mocked(useViewerStore().ensureAccount).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await flushPromises()
    await wrapper.find('.select-project').trigger('click')
    await flushPromises()
    expect(createSpace).not.toHaveBeenCalled()

    await wrapper.find('.select-project').trigger('click')
    await flushPromises()
    expect(ensureAccount).toHaveBeenCalledTimes(2)
    expect(createSpace).toHaveBeenCalledWith({ name: 'My idea' })
  })

  it('adds a repository from a Git URL in the box and opens it', async () => {
    addRemote.mockResolvedValue({ slug: 'plans' })
    const wrapper = mountServer('https://github.com/someone/plans.git')
    vi.mocked(useViewerStore().ensureAccount).mockResolvedValue(true)
    await flushPromises()
    expect(wrapper.find('.select-project').text()).toBe('Add from Git')
    await wrapper.find('.select-project').trigger('click')
    await flushPromises()
    expect(addRemote).toHaveBeenCalledWith({ url: 'https://github.com/someone/plans.git' })
    expect(wrapper.emitted('open-space')).toEqual([['plans']])
  })

  it('adds a repository of the server by its path, for server admins only', async () => {
    addCheckout.mockResolvedValue({ slug: 'repo' })
    const admin = mountServer('/srv/repo', { serverAdmin: true })
    await flushPromises()
    expect(admin.find('.select-project').text()).toBe('Add from server')
    await admin.find('.select-project').trigger('click')
    await flushPromises()
    expect(addCheckout).toHaveBeenCalledWith({ path: '/srv/repo' })
    expect(mountServer('/srv/repo').find('.select-project').text()).toBe('New space')
  })

  it('with nothing typed shows a disabled New space and lists the ways to add one, the server path for admins only', async () => {
    const admin = mountServer('', { serverAdmin: true })
    await flushPromises()
    expect(admin.find('.select-project').text()).toBe('New space')
    expect(admin.find('.select-project').attributes('disabled')).toBeDefined()
    const ways = (wrapper: ReturnType<typeof mountView>) => wrapper.findAll('.ways strong').map(way => way.text())
    expect(ways(admin)).toEqual(['a name', 'a Git URL (GitHub, …)', 'a path on this server (/…)'])
    expect(ways(mountServer(''))).toEqual(['a name', 'a Git URL (GitHub, …)'])
    await admin.setProps({ modelValue: 'My idea' })
    expect(admin.find('.ways').exists()).toBe(false)
    expect(admin.find('.select-project').attributes('disabled')).toBeUndefined()
  })

  it('asks a visitor to log in before creating a space', async () => {
    const wrapper = mountServer('My idea', { name: null, canCreateSpaces: false })
    await flushPromises()
    expect(wrapper.find('.select-project').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Log in to create a space.')
  })
})

describe('ProjectSelectionView: a recent space that moved', () => {
  const kitchen = { path: '/work/kitchen', lastOpened: 1, failedToLoad: false, repoId: 'kitchen-id', name: 'Kitchen' }
  const mountWithKitchen = () => mount(ProjectSelectionView, {
    attachTo: document.body,
    global: { plugins: [createTestingPinia({ createSpy: vi.fn })], stubs: { LoginControl: true } },
    props: { modelValue: '', projectHistory: [kitchen], discoveredProjects: [], scannedRoots: [], isRefreshingDiscoveredProjects: false },
  })
  beforeEach(() => { accounts.on = false; discoverLocalProjects.mockReset() })

  it('is found by its id and opened from where it is now', async () => {
    discoverLocalProjects
      .mockResolvedValueOnce({ projects: [] }) // the recent folders: /work/kitchen is gone
      .mockResolvedValueOnce({ projects: [
        { path: '/archive/kitchen', bowmanPath: '/archive/kitchen/.bowman', sourceRoot: '/', name: 'Kitchen', repoId: 'kitchen-id', matchedBy: 'id' },
        { path: '/other/kitchen', bowmanPath: '/other/kitchen/.bowman', sourceRoot: '/', name: 'Kitchen', repoId: 'other', matchedBy: 'name' }
      ] })
    const wrapper = mountWithKitchen()
    await flushPromises()
    expect(wrapper.find('.history-item').classes()).toContain('failed')

    await wrapper.find('[aria-label="Find it on this machine"]').trigger('click')
    await flushPromises()
    expect(discoverLocalProjects).toHaveBeenLastCalledWith(expect.objectContaining({ repoId: 'kitchen-id', name: 'Kitchen' }))
    expect(useProjectStore().relocateProjectInHistory).toHaveBeenCalledWith('/work/kitchen', '/archive/kitchen', { repoId: 'kitchen-id', name: 'Kitchen' })
    expect(wrapper.emitted('open-project-from-history')).toEqual([['/archive/kitchen']])
    wrapper.unmount()
  })

  it('takes a path typed by hand, and asks first when another space is there', async () => {
    discoverLocalProjects
      .mockResolvedValueOnce({ projects: [] })
      .mockResolvedValueOnce({ projects: [] }) // nothing found by id or name
      .mockResolvedValueOnce({ projects: [{ path: '/elsewhere', bowmanPath: '/elsewhere/.bowman', sourceRoot: '/elsewhere', name: 'Garden', repoId: 'garden-id' }] })
    const wrapper = mountWithKitchen()
    await flushPromises()
    await wrapper.find('[aria-label="Find it on this machine"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Not found')

    await wrapper.find('input[aria-label="Its new path"]').setValue('/elsewhere')
    await wrapper.find('.typed').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('That is another space (Garden)')
    expect(wrapper.emitted('open-project-from-history')).toBeUndefined()

    await wrapper.findAll('.problem button')[0]!.trigger('click')
    expect(wrapper.emitted('open-project-from-history')).toEqual([['/elsewhere']])
    wrapper.unmount()
  })
})

describe('ProjectSelectionView: a server checkout whose folder moved', () => {
  it('is marked, so its operator knows to relocate it', async () => {
    accounts.on = true
    listSpaces.mockResolvedValueOnce([{ slug: 'kitchen', kind: 'checkout', name: 'Kitchen', color: null, owner: null, right: 'owner', missing: true }])
    const wrapper = mount(ProjectSelectionView, {
      attachTo: document.body,
      global: { plugins: [createTestingPinia({ createSpy: vi.fn })], stubs: { LoginControl: true } },
      props: { modelValue: '', projectHistory: [], discoveredProjects: [], scannedRoots: [], isRefreshingDiscoveredProjects: false },
    })
    await flushPromises()
    const item = wrapper.find('.history-item')
    expect(item.classes()).toContain('failed')
    expect(item.text()).toContain('folder moved')
    wrapper.unmount()
    accounts.on = false
  })
})
