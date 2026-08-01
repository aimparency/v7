import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWatchdogStore } from '../watchdog'
import { useProjectStore } from '../project-store'

const mockSocket = {
  removeAllListeners: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  emit: vi.fn()
}

const { mockIo, mockTrpcWatchdog, mockTrpc } = vi.hoisted(() => ({
  mockIo: vi.fn(() => mockSocket),
  mockTrpcWatchdog: {
    watchdog: {
      list: { query: vi.fn() },
      keepalive: { mutate: vi.fn().mockResolvedValue({ success: true }) },
      start: { mutate: vi.fn() },
      stop: { mutate: vi.fn() },
      relaunch: { mutate: vi.fn() },
      getStatus: { query: vi.fn() }
    }
  },
  mockTrpc: {
    project: {
      getWatchdogRuntimeState: { query: vi.fn() },
      getAutonomyPolicy: { query: vi.fn() },
      updateWatchdogRuntimeState: { mutate: vi.fn() },
      updateAutonomyPolicy: { mutate: vi.fn() }
    }
  }
}))

vi.mock('socket.io-client', () => ({
  io: mockIo
}))

vi.mock('../../trpc-watchdog', () => ({
  trpcWatchdog: mockTrpcWatchdog
}))

vi.mock('../../trpc', () => ({
  trpc: mockTrpc
}))

vi.mock('../../utils/runtime-config', () => ({
  buildHttpUrl: (port: number) => `http://127.0.0.1:${port}`
}))

describe('watchdog store project switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())

    mockTrpcWatchdog.watchdog.list.query.mockResolvedValue([
      { projectPath: '/projects/a', pid: 1, port: 4101, agentType: 'claude', lastKeepalive: Date.now() },
      { projectPath: '/projects/b', pid: 2, port: 4102, agentType: 'claude', lastKeepalive: Date.now() }
    ])

    mockTrpc.project.getWatchdogRuntimeState.query.mockResolvedValue({
      updatedAt: Date.now(),
      agents: {
        claude: {
          enabled: false,
          emergencyStopped: false,
          stopReason: null,
          updatedAt: Date.now()
        }
      }
    })

    mockTrpc.project.getAutonomyPolicy.query.mockResolvedValue({
      version: 1,
      autonomyMode: 'manual',
      preferredAgentType: 'claude',
      sessionLeaseMinutes: 60,
      autoConnectToExistingSession: true,
      restoreSupervisorStateOnSessionRestart: true,
      requireCommitBeforeCompact: false,
      askForHumanOn: []
    })
  })

  it('hydrates and derives the latest blocked authority decision', async () => {
    const projectStore = useProjectStore()
    const store = useWatchdogStore()
    projectStore.projectPath = '/projects/a'
    mockTrpc.project.getWatchdogRuntimeState.query.mockResolvedValueOnce({
      updatedAt: 3,
      agents: {
        claude: {
          enabled: false,
          emergencyStopped: false,
          stopReason: 'Human authorization required',
          updatedAt: 3,
          supervisorState: {
            state: 'WORKING',
            color: '#ffffff',
            authorityAudit: [
              { timestamp: 1, actionType: 'start_work', disposition: 'execute', reasons: ['authorized_bounded_action'] },
              { timestamp: 2, actionType: 'choice', disposition: 'escalate', reasons: ['material_choice_required'] }
            ]
          }
        }
      }
    })

    await store.hydrateRuntimeState('/projects/a', 'claude', { suppressAutoStart: true })

    expect(store.latestBlockedAuthorityDecision).toEqual({
      timestamp: 2,
      actionType: 'choice',
      disposition: 'escalate',
      reasons: ['material_choice_required']
    })
  })

  it('tears down the previous socket when switching projects', async () => {
    const projectStore = useProjectStore()
    const store = useWatchdogStore()

    projectStore.projectPath = '/projects/b'
    store.socket = mockSocket as any
    store.isConnected = true
    store.connectedAgentType = 'claude'
    localStorage.setItem('aimparency-watchdog-should-connect', 'true')

    await store.handleProjectSwitch('/projects/b', '/projects/a')

    expect(mockSocket.removeAllListeners).toHaveBeenCalled()
    expect(mockSocket.disconnect).toHaveBeenCalled()
    expect(mockIo).toHaveBeenCalledWith('http://127.0.0.1:4102', expect.any(Object))
  })

  it('does not reconnect when switching projects if watchdog was not connected', async () => {
    const projectStore = useProjectStore()
    const store = useWatchdogStore()

    projectStore.projectPath = '/projects/b'
    store.socket = null
    store.isConnected = false
    localStorage.setItem('aimparency-watchdog-should-connect', 'false')

    await store.handleProjectSwitch('/projects/b', '/projects/a')

    expect(mockIo).not.toHaveBeenCalled()
  })

  it('restores the session for the new project after switching', async () => {
    const projectStore = useProjectStore()
    const store = useWatchdogStore()

    projectStore.projectPath = '/projects/b'
    store.socket = mockSocket as any
    store.isConnected = true
    store.connectedAgentType = 'claude'
    localStorage.setItem('aimparency-watchdog-should-connect', 'true')

    await store.handleProjectSwitch('/projects/b', '/projects/a')

    expect(mockIo).toHaveBeenCalledWith('http://127.0.0.1:4102', expect.any(Object))
    expect(store.connectedAgentType).toBe('claude')
  })

  it('forces reconnect on project switch even when autoConnectToExistingSession is false', async () => {
    const projectStore = useProjectStore()
    const store = useWatchdogStore()

    mockTrpc.project.getAutonomyPolicy.query.mockResolvedValue({
      version: 1,
      autonomyMode: 'manual',
      preferredAgentType: 'claude',
      sessionLeaseMinutes: 60,
      autoConnectToExistingSession: false,
      restoreSupervisorStateOnSessionRestart: true,
      requireCommitBeforeCompact: false,
      askForHumanOn: []
    })

    projectStore.projectPath = '/projects/b'
    store.socket = mockSocket as any
    store.isConnected = true
    store.connectedAgentType = 'claude'

    await store.handleProjectSwitch('/projects/b', '/projects/a')

    expect(mockIo).toHaveBeenCalledWith('http://127.0.0.1:4102', expect.any(Object))
  })

  it('switches agent sessions without clearing should-connect or refetching sessions', async () => {
    const projectStore = useProjectStore()
    const store = useWatchdogStore()

    projectStore.projectPath = '/projects/a'
    store.socket = mockSocket as any
    store.isConnected = true
    store.connectedAgentType = 'claude'
    store.selectedAgentType = 'claude'
    localStorage.setItem('aimparency-watchdog-should-connect', 'true')
    store.sessions = [
      { projectPath: '/projects/a', pid: 1, port: 4101, agentType: 'claude', lastKeepalive: Date.now() },
      { projectPath: '/projects/a', pid: 2, port: 4102, agentType: 'grok', lastKeepalive: Date.now() }
    ]

    await store.switchAgentType('grok')

    expect(mockTrpcWatchdog.watchdog.list.query).not.toHaveBeenCalled()
    expect(mockSocket.disconnect).toHaveBeenCalled()
    expect(mockIo).toHaveBeenCalledWith('http://127.0.0.1:4102', expect.any(Object))
    expect(localStorage.getItem('aimparency-watchdog-should-connect')).toBe('true')
    expect(store.selectedAgentType).toBe('grok')
  })

  it('drops terminal input while a worker rebuild is in progress', () => {
    const store = useWatchdogStore()
    store.socket = mockSocket as any
    store.isRebuilding = true

    store.sendWorkerInput('unsafe worker input')
    store.sendWatchdogInput('unsafe supervisor input')

    expect(mockSocket.emit).not.toHaveBeenCalled()
  })
})
