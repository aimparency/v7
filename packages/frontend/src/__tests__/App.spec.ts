import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import App from '../App.vue'
import { useProjectStore } from '../stores/project-store'

const { mockTrpc } = vi.hoisted(() => ({
  mockTrpc: {
    project: {
      buildSearchIndex: { mutate: vi.fn() },
      discoverLocalProjects: { query: vi.fn().mockResolvedValue({ rootsScanned: [], projects: [] }) }
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
})
