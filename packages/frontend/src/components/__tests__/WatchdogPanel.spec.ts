import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import WatchdogPanel from '../WatchdogPanel.vue'

const watchdogStore = reactive({
  isConnected: true,
  connectionState: 'connected' as 'idle' | 'spawning' | 'connecting' | 'connected' | 'error',
  connectedAgentType: 'claude' as 'claude' | 'gemini' | 'codex' | null,
  selectedAgentType: 'claude' as 'claude' | 'gemini' | 'codex',
  sessions: [
    { projectPath: '/test/project', pid: 1, port: 4101, agentType: 'claude' as const, lastKeepalive: 1 }
  ],
  autonomyPolicy: null as any,
  runtimeMetadata: null as any,
  supervisorState: null as any,
  workerOutput: '',
  watchdogOutput: '',
  spawningLog: [] as string[],
  showActionsOverlay: false,
  focusRequestCounter: 0,
  stopReason: '',
  isEnabled: false,
  socket: null as any,
  fetchSessions: vi.fn().mockResolvedValue(undefined),
  restorePreviousConnection: vi.fn().mockResolvedValue(false),
  hydrateAutonomyPolicy: vi.fn().mockResolvedValue(null),
  hydrateRuntimeState: vi.fn().mockResolvedValue(null),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(() => {
    watchdogStore.isConnected = false
    watchdogStore.connectedAgentType = null
    watchdogStore.connectionState = 'idle'
  }),
  cancelConnectionAttempt: vi.fn(),
  stop: vi.fn(),
  relaunch: vi.fn(),
  toggle: vi.fn(),
  sendWorkerInput: vi.fn(),
  sendWatchdogInput: vi.fn(),
  setAgentType: vi.fn((type: 'claude' | 'gemini' | 'codex') => {
    watchdogStore.selectedAgentType = type
  }),
  get currentProjectSession() {
    return watchdogStore.sessions.find(
      (session) =>
        session.projectPath === projectStore.projectPath &&
        session.agentType === watchdogStore.selectedAgentType
    ) ?? null
  }
})

const projectStore = reactive({
  projectPath: '/test/project'
})

const modalStore = reactive({
  showAimSearch: false,
  showPhaseSearchPrompt: false,
  showAimModal: false,
  showPhaseModal: false,
  showSettingsModal: false,
  openAimSearch: vi.fn()
})

vi.mock('../../stores/watchdog', () => ({
  useWatchdogStore: () => watchdogStore
}))

vi.mock('../../stores/project-store', () => ({
  useProjectStore: () => projectStore
}))

vi.mock('../../stores/ui/modal-store', () => ({
  useUIModalStore: () => modalStore
}))

describe('WatchdogPanel', () => {
  beforeEach(() => {
    watchdogStore.isConnected = true
    watchdogStore.connectionState = 'connected'
    watchdogStore.connectedAgentType = 'claude'
    watchdogStore.selectedAgentType = 'claude'
    watchdogStore.sessions = [
      { projectPath: '/test/project', pid: 1, port: 4101, agentType: 'claude', lastKeepalive: 1 }
    ]
    projectStore.projectPath = '/test/project'
    vi.clearAllMocks()
    watchdogStore.fetchSessions.mockResolvedValue(undefined)
    watchdogStore.restorePreviousConnection.mockResolvedValue(false)
    watchdogStore.hydrateAutonomyPolicy.mockResolvedValue(null)
    watchdogStore.hydrateRuntimeState.mockResolvedValue(null)
    watchdogStore.connect.mockResolvedValue(undefined)
    watchdogStore.autonomyPolicy = null
    watchdogStore.runtimeMetadata = null
    watchdogStore.supervisorState = null
    watchdogStore.stopReason = ''
    watchdogStore.isEnabled = false
  })

  it('does not auto-restore the previous session when the selected agent type changes', async () => {
    const wrapper = mount(WatchdogPanel, {
      global: {
        stubs: {
          WatchdogTerminal: {
            template: '<div />',
            methods: {
              write() {},
              clear() {},
              focus() {}
            }
          },
          WatchdogActionsOverlay: true
        }
      }
    })

    await nextTick()
    expect(watchdogStore.restorePreviousConnection).toHaveBeenCalledTimes(1)

    const select = wrapper.get('select.agent-select')
    await select.setValue('codex')
    await nextTick()

    expect(watchdogStore.selectedAgentType).toBe('codex')
    expect(watchdogStore.restorePreviousConnection).toHaveBeenCalledTimes(1)
    expect(watchdogStore.disconnect).toHaveBeenCalledTimes(1)
    expect(watchdogStore.connect).not.toHaveBeenCalled()
  })

  it('commits the new selection before disconnecting the current session', async () => {
    const events: string[] = []
    watchdogStore.setAgentType.mockImplementation((type: 'claude' | 'gemini' | 'codex') => {
      events.push(`set:${type}`)
      watchdogStore.selectedAgentType = type
    })
    watchdogStore.disconnect.mockImplementation(() => {
      events.push('disconnect')
      watchdogStore.isConnected = false
      watchdogStore.connectedAgentType = null
      watchdogStore.connectionState = 'idle'
    })

    const wrapper = mount(WatchdogPanel, {
      global: {
        stubs: {
          WatchdogTerminal: {
            template: '<div />',
            methods: {
              write() {},
              clear() {},
              focus() {}
            }
          },
          WatchdogActionsOverlay: true
        }
      }
    })

    await nextTick()
    const select = wrapper.get('select.agent-select')
    await select.setValue('codex')
    await nextTick()

    expect(events).toEqual(['set:codex', 'disconnect'])
  })

  it('renders lease in the wrapper header and supervisor controls in the supervisor header', async () => {
    watchdogStore.autonomyPolicy = {
      sessionLeaseMinutes: 45
    }
    watchdogStore.runtimeMetadata = {
      agents: {
        claude: {
          enabled: false,
          emergencyStopped: false,
          stopReason: null,
          updatedAt: 1
        }
      }
    }
    watchdogStore.supervisorState = { state: 'EXPLORING' }

    const wrapper = mount(WatchdogPanel, {
      global: {
        stubs: {
          WatchdogTerminal: {
            template: '<div />',
            methods: {
              write() {},
              clear() {},
              focus() {}
            }
          },
          WatchdogActionsOverlay: true
        }
      }
    })

    await nextTick()

    expect(wrapper.text()).toContain('Lease: 45min')
    expect(wrapper.text()).toContain('Supervisor')
    expect(wrapper.text()).toContain('State: exploring')
    expect(wrapper.text()).toContain('automate')
    expect(wrapper.text()).not.toContain('Worker (Main Agent)')
    expect(wrapper.text()).not.toContain('Owner:')
    expect(wrapper.text()).not.toContain('Watchdog (Animator)')
    expect(wrapper.text()).not.toContain('Enable Animator')
    expect(wrapper.text()).not.toContain('Animator State:')
  })

  it('renders supervisor state color from hydrated state metadata', async () => {
    watchdogStore.supervisorState = {
      state: 'WORKING',
      color: '#f59e0b'
    }

    const wrapper = mount(WatchdogPanel, {
      global: {
        stubs: {
          WatchdogTerminal: {
            template: '<div />',
            methods: {
              write() {},
              clear() {},
              focus() {}
            }
          },
          WatchdogActionsOverlay: true
        }
      }
    })

    await nextTick()

    const state = wrapper.get('.term-label-supervisor .term-state')
    expect(state.text()).toBe('State: working')
    expect(state.attributes('style')).toContain('color: rgb(245, 158, 11)')
  })

  it('reactively updates supervisor state text and color from live state changes', async () => {
    watchdogStore.supervisorState = {
      state: 'EXPLORING',
      color: '#22c55e'
    }

    const wrapper = mount(WatchdogPanel, {
      global: {
        stubs: {
          WatchdogTerminal: {
            template: '<div />',
            methods: {
              write() {},
              clear() {},
              focus() {}
            }
          },
          WatchdogActionsOverlay: true
        }
      }
    })

    await nextTick()

    const state = wrapper.get('.term-label-supervisor .term-state')
    expect(state.text()).toBe('State: exploring')
    expect(state.attributes('style')).toContain('color: rgb(34, 197, 94)')

    watchdogStore.supervisorState = {
      state: 'WRAPPING_UP',
      color: '#38bdf8'
    }
    await nextTick()

    expect(state.text()).toBe('State: wrapping_up')
    expect(state.attributes('style')).toContain('color: rgb(56, 189, 248)')
  })
})
