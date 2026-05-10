import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import App from '../App.vue'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'

const { mockTrpc } = vi.hoisted(() => ({
  mockTrpc: {
    project: {
      buildSearchIndex: { mutate: vi.fn() },
      discoverLocalProjects: { query: vi.fn().mockResolvedValue({ rootsScanned: [], projects: [] }) },
      getMeta: { query: vi.fn().mockResolvedValue({ name: 'Test', color: '#007acc', rootPhaseIds: [] }) },
      onUpdate: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }
    },
    aim: {
      list: { query: vi.fn().mockResolvedValue([]) }
    }
  }
}))

const { mockRuntimeConfig } = vi.hoisted(() => ({
  mockRuntimeConfig: {
    voiceEnabled: false
  }
}))

vi.mock('../trpc', () => ({
  trpc: mockTrpc
}))

vi.mock('../utils/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/runtime-config')>()
  return {
    ...actual,
    getRuntimeConfig: () => mockRuntimeConfig
  }
})

describe('App', () => {
  beforeEach(() => {
    mockRuntimeConfig.voiceEnabled = false
  })

  it('hides voice controls by default', async () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: true,
          PhaseSearchModal: true,
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: true
        }
      }
    })

    const projectStore = useProjectStore()
    projectStore.projectPath = '/workspaces/aimparency-demo'
    await nextTick()

    expect(wrapper.text()).not.toContain('Voice')
    expect(wrapper.text()).not.toContain('voice mode')
  })

  it('shows voice controls when runtime config enables them', async () => {
    mockRuntimeConfig.voiceEnabled = true

    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: true,
          PhaseSearchModal: true,
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: true
        }
      }
    })

    const projectStore = useProjectStore()
    projectStore.projectPath = '/workspaces/aimparency-demo'
    await nextTick()

    expect(wrapper.text()).toContain('Voice')
  })

  it('mounts renders properly', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
        })],
        stubs: {
          // Stub complex components if needed to speed up test
          WatchdogPanel: true,
          Column: true,
          GraphView: true,
          VoiceAgent: true
        }
      }
    })
    // Expect project name or something from the UI
    expect(wrapper.exists()).toBe(true)
  })

  it('shows both project root and .bowman root in the header for an open project', async () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: true,
          PhaseSearchModal: true,
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: true
        }
      }
    })

    const projectStore = useProjectStore()
    projectStore.projectPath = '/workspaces/aimparency-demo'
    await nextTick()

    expect(wrapper.text()).toContain('Project')
    expect(wrapper.text()).toContain('aimparency-demo')
    expect(wrapper.text()).toContain('/workspaces/aimparency-demo')
    expect(wrapper.text()).toContain('/workspaces/aimparency-demo/.bowman')
  })

  it('passes discovered projects into the selection screen', async () => {
    mockTrpc.project.discoverLocalProjects.query.mockResolvedValueOnce({
      rootsScanned: ['/workspaces'],
      projects: [
        {
          path: '/workspaces/demo',
          bowmanPath: '/workspaces/demo/.bowman',
          sourceRoot: '/workspaces'
        }
      ]
    })

    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: true,
          PhaseSearchModal: true,
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: {
            props: ['discoveredProjects', 'scannedRoots'],
            template: '<div>{{ discoveredProjects[0]?.path }}|{{ scannedRoots[0] }}</div>'
          }
        }
      }
    })

    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('/workspaces/demo')
    expect(wrapper.text()).toContain('/workspaces')
  })

  it('keeps aim search mounted after a keepOpen selection', async () => {
    const callback = vi.fn()
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          stubActions: false
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: {
            emits: ['select', 'close'],
            template: '<button class="emit-aim" @click="$emit(\'select\', { type: \'aim\', data: { id: \'a1\', text: \'Parent aim\', status: { state: \'open\' } }, keepOpen: true })">select aim</button>'
          },
          PhaseSearchModal: true,
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: true
        }
      }
    })

    const modalStore = useUIModalStore()
    modalStore.showAimSearch = true
    modalStore.aimSearchMode = 'pick'
    modalStore.aimSearchCallback = callback
    await nextTick()

    await wrapper.find('.emit-aim').trigger('click')

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: 'aim', keepOpen: true }))
    expect(modalStore.showAimSearch).toBe(true)
  })

  it('keeps phase search mounted after a keepOpen selection', async () => {
    const callback = vi.fn()
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          stubActions: false
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: true,
          PhaseSearchModal: {
            emits: ['select', 'close'],
            template: '<button class="emit-phase" @click="$emit(\'select\', { type: \'phase\', data: { id: \'phase-1\', name: \'Release Prep\', from: 0, to: 1, parent: null }, keepOpen: true })">select phase</button>'
          },
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: true
        }
      }
    })

    const modalStore = useUIModalStore()
    modalStore.showPhaseSearchPrompt = true
    modalStore.phaseSearchPromptCallback = callback
    await nextTick()

    await wrapper.find('.emit-phase').trigger('click')

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: 'phase', keepOpen: true }))
    expect(modalStore.showPhaseSearchPrompt).toBe(true)
  })

  it('opens project selection with p and opens recent projects with number shortcuts', async () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          stubActions: false
        })],
        stubs: {
          WatchdogPanel: true,
          ColumnsView: true,
          GraphViewWrapper: true,
          VoiceView: true,
          PhaseCreationModal: true,
          AimCreationModal: true,
          AimEditModal: true,
          AimSearchModal: true,
          PhaseSearchModal: true,
          ConsistencyModal: true,
          ProjectSettingsModal: true,
          ProjectSelectionView: {
            props: ['projectHistory'],
            template: '<div class="project-selection-stub">{{ projectHistory.map((p) => p.path).join("|") }}</div>'
          }
        }
      }
    })

    const projectStore = useProjectStore()
    projectStore.projectPath = '/workspaces/current'
    projectStore.projectHistory = [
      { path: '/workspaces/one', lastOpened: 2, failedToLoad: false },
      { path: '/workspaces/two', lastOpened: 1, failedToLoad: false }
    ]
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }))
    await nextTick()

    expect(projectStore.projectPath).toBe('')
    expect(wrapper.text()).toContain('/workspaces/one')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }))
    await nextTick()

    expect(projectStore.projectPath).toBe('/workspaces/two')
  })
})
