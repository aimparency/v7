import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ProjectSettingsModal from '../ProjectSettingsModal.vue'
import { useDataStore } from '../../stores/data'
import { useProjectStore } from '../../stores/project-store'

const { listMock, registerMock, unregisterMock, discoverMock, policy } = vi.hoisted(() => ({
  listMock: vi.fn(),
  registerMock: vi.fn().mockResolvedValue({}),
  unregisterMock: vi.fn().mockResolvedValue({ removed: true }),
  discoverMock: vi.fn(),
  policy: {
    autonomyMode: 'supervised',
    preferredAgentType: null,
    sessionLeaseMinutes: 60,
    autoConnectToExistingSession: true,
    restoreSupervisorStateOnSessionRestart: true,
    requireCommitBeforeCompact: true,
    askForHumanOn: ['network']
  }
}))

vi.mock('../../trpc', () => ({
  trpc: {
    project: {
      getMeta: { query: vi.fn().mockResolvedValue(null) },
      getWatchdogRuntimeState: { query: vi.fn().mockResolvedValue({ updatedAt: 0, agents: {} }) },
      getAutonomyPolicy: { query: vi.fn().mockResolvedValue(policy) },
      updateAutonomyPolicy: { mutate: vi.fn().mockResolvedValue({}) },
      discoverLocalProjects: { query: discoverMock }
    },
    linkedRepo: {
      list: { query: listMock },
      register: { mutate: registerMock },
      unregister: { mutate: unregisterMock }
    }
  }
}))

const SELF_BOWMAN = '/test/project/.bowman'
const SIBLING = { path: '/test/sibling', bowmanPath: '/test/sibling/.bowman', sourceRoot: '/test' }
const SELF = { path: '/test/project', bowmanPath: SELF_BOWMAN, sourceRoot: '/test' }

function mountModal() {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      'ui-modal': { showSettingsModal: true },
      'ui-project': { projectPath: SELF_BOWMAN },
      data: { meta: { name: 'P', color: '#007acc', statuses: [] } }
    }
  })
  const wrapper = mount(ProjectSettingsModal, { global: { plugins: [pinia] } })
  const dataStore = useDataStore(pinia)
  const projectStore = useProjectStore(pinia)
  dataStore.meta = { name: 'P', color: '#007acc', statuses: [] } as any
  projectStore.projectPath = SELF_BOWMAN
  return { wrapper, dataStore }
}

describe('ProjectSettingsModal linked repos', () => {
  beforeEach(() => {
    registerMock.mockClear()
    unregisterMock.mockClear()
    listMock.mockReset()
    discoverMock.mockReset()
  })

  it('lists registered repos and offers only unlinked discovered projects', async () => {
    listMock.mockResolvedValue([
      { repoId: 'r-sib', name: 'Sibling', localPath: SIBLING.bowmanPath, access: 'read', resolved: true }
    ])
    discoverMock.mockResolvedValue({ projects: [SELF, SIBLING], rootsScanned: ['/test'] })

    const { wrapper } = mountModal()
    await flushPromises()

    // The already-linked repo is listed by name.
    expect(wrapper.text()).toContain('Sibling')

    // Self and the already-linked sibling are both excluded → only the
    // placeholder option remains in the select.
    const optionValues = wrapper.find('.add-repo-row select').findAll('option').map((o) => o.element.value)
    expect(optionValues).toEqual([''])
  })

  it('registers a selected discovered project on Link', async () => {
    listMock.mockResolvedValue([]) // nothing linked yet
    discoverMock.mockResolvedValue({ projects: [SELF, SIBLING], rootsScanned: ['/test'] })

    const { wrapper } = mountModal()
    await flushPromises()

    // The sibling is offered (self excluded).
    const select = wrapper.find('.add-repo-row select')
    expect(select.findAll('option').map((o) => o.element.value)).toContain(SIBLING.path)

    await select.setValue(SIBLING.path)
    await wrapper.find('.add-repo-btn').trigger('click')
    await flushPromises()

    expect(registerMock).toHaveBeenCalledWith({ projectPath: SELF_BOWMAN, targetPath: SIBLING.path })
  })

  it('loads initial instructions from meta and persists edits on Save', async () => {
    listMock.mockResolvedValue([])
    discoverMock.mockResolvedValue({ projects: [], rootsScanned: [] })

    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-modal': { showSettingsModal: true },
        'ui-project': { projectPath: SELF_BOWMAN },
        data: { meta: { name: 'P', color: '#007acc', statuses: [], initialInstructions: 'work directly on main', supervisorGuidancePrefix: 'Improve this supervisor.' } }
      }
    })
    const wrapper = mount(ProjectSettingsModal, { global: { plugins: [pinia] } })
    const dataStore = useDataStore(pinia)
    const projectStore = useProjectStore(pinia)
    dataStore.meta = { name: 'P', color: '#007acc', statuses: [], initialInstructions: 'work directly on main', supervisorGuidancePrefix: 'Improve this supervisor.' } as any
    projectStore.projectPath = SELF_BOWMAN
    await flushPromises()

    const textarea = wrapper.find('textarea.instructions-input')
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe('work directly on main')
    const prefixTextarea = wrapper.find('textarea.supervisor-guidance-input')
    expect((prefixTextarea.element as HTMLTextAreaElement).value).toBe('Improve this supervisor.')

    await textarea.setValue('work directly on main, no PRs')
    await prefixTextarea.setValue('You can improve this system.')
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(dataStore.updateProjectMeta).toHaveBeenCalledWith(
      SELF_BOWMAN,
      expect.objectContaining({
        initialInstructions: 'work directly on main, no PRs',
        supervisorGuidancePrefix: 'You can improve this system.'
      })
    )
  })

  it('unregisters a repo after a confirm click', async () => {
    listMock.mockResolvedValue([
      { repoId: 'r-sib', name: 'Sibling', localPath: SIBLING.bowmanPath, access: 'read', resolved: true }
    ])
    discoverMock.mockResolvedValue({ projects: [SELF, SIBLING], rootsScanned: ['/test'] })

    const { wrapper } = mountModal()
    await flushPromises()

    const removeBtn = wrapper.find('.linked-repo-row .delete-btn')
    await removeBtn.trigger('click') // first click arms the confirm
    expect(unregisterMock).not.toHaveBeenCalled()

    await removeBtn.trigger('click') // second click confirms
    await flushPromises()

    expect(unregisterMock).toHaveBeenCalledWith({ projectPath: SELF_BOWMAN, repoId: 'r-sib' })
  })
})
