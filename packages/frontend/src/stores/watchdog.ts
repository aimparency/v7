import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { ref, computed } from 'vue'
import { trpc } from '../trpc'
import { trpcWatchdog } from '../trpc-watchdog'
import { buildHttpUrl } from '../utils/runtime-config'
import { useProjectStore } from './project-store'

export type AgentType = 'claude' | 'gemini' | 'codex'

interface WatchdogRuntimeAgentState {
  enabled: boolean
  emergencyStopped: boolean
  stopReason: string | null
  updatedAt: number
}

interface WatchdogRuntimeState {
  updatedAt: number
  preferredAgentType?: AgentType | null
  agents: Partial<Record<AgentType, WatchdogRuntimeAgentState>>
}

interface AnimatorStateInfo {
  state: string
  color?: string
}

interface AutonomyPolicy {
  version: number
  autonomyMode: 'manual' | 'supervised' | 'autonomous'
  preferredAgentType: AgentType | null
  sessionLeaseMinutes: number
  autoConnectToExistingSession: boolean
  restoreAnimatorStateOnSessionRestart: boolean
  requireCommitBeforeCompact: boolean
  askForHumanOn: string[]
}

export const useWatchdogStore = defineStore('watchdog', () => {
  const socket = ref<Socket | null>(null)
  const isConnected = ref(false)
  const connectionState = ref<'idle' | 'spawning' | 'connecting' | 'connected' | 'error'>('idle')
  const isEnabled = ref(false)
  const isEmergencyStopped = ref(false)
  const stopReason = ref('')
  const supervisorState = ref<AnimatorStateInfo | null>(null)
  const showActionsOverlay = ref(false)
  const focusRequestCounter = ref(0)
  const autonomyPolicy = ref<AutonomyPolicy | null>(null)
  const runtimeMetadata = ref<WatchdogRuntimeState | null>(null)

  // Agent type selection with localStorage persistence
  const storedAgentType = localStorage.getItem('aimparency-agent-type') as AgentType | null
  const selectedAgentType = ref<AgentType>(storedAgentType || 'claude')

  // Track which agent type we're currently connected to
  const connectedAgentType = ref<AgentType | null>(null)

  // Terminal buffers - per-agent structure
  const agentBuffers = ref<Record<AgentType, { worker: string; watchdog: string }>>({
    claude: { worker: '', watchdog: '' },
    gemini: { worker: '', watchdog: '' },
    codex: { worker: '', watchdog: '' }
  })

  // Computed accessors for backward compatibility
  const workerOutput = computed(() => {
    const agent = connectedAgentType.value || selectedAgentType.value
    return agentBuffers.value[agent].worker
  })

  const watchdogOutput = computed(() => {
    const agent = connectedAgentType.value || selectedAgentType.value
    return agentBuffers.value[agent].watchdog
  })

  const spawningLog = ref<string[]>([])

  const logStatus = (msg: string) => {
    console.log(`[Watchdog] ${msg}`)
    spawningLog.value.push(`${new Date().toLocaleTimeString()}: ${msg}`)
    if (spawningLog.value.length > 50) spawningLog.value.shift()
  }

  interface WatchdogSession {
    projectPath: string
    pid: number
    port: number
    agentType: AgentType
    lastKeepalive: number
  }
  const sessions = ref<WatchdogSession[]>([])
  const normalizeProjectPathForSession = (p: string) => p.replace(/\/+$/, '').replace(/\/\.bowman$/, '')
  const getSessionsForProject = (projectPath: string) => {
    const normalizedProjectPath = normalizeProjectPathForSession(projectPath)
    return sessions.value.filter((session) =>
      normalizeProjectPathForSession(session.projectPath) === normalizedProjectPath
    )
  }
  // Get session for currently selected agent type and project
  const currentProjectSession = computed(() => {
    const projectStore = useProjectStore()
    if (!projectStore.projectPath) return null
    
    const normalizedUiPath = normalizeProjectPathForSession(projectStore.projectPath)
    
    return sessions.value.find(
      s => {
        const normalizedSessionPath = normalizeProjectPathForSession(s.projectPath)
        return normalizedSessionPath === normalizedUiPath && s.agentType === selectedAgentType.value
      }
    ) || null
  })

  function setAgentType(type: AgentType) {
    selectedAgentType.value = type
    localStorage.setItem('aimparency-agent-type', type)
    const projectStore = useProjectStore()
    if (projectStore.projectPath) {
      void trpcWatchdogRuntimePreference(projectStore.projectPath, type)
    }
    void hydrateRuntimeState(undefined, type)
  }

  async function trpcWatchdogRuntimePreference(projectPath: string, preferredAgentType: AgentType) {
    try {
      await trpc.project.updateWatchdogRuntimeState.mutate({
        projectPath,
        preferredAgentType
      })
    } catch (e: any) {
      logStatus(`Failed to persist preferred agent type: ${e.message}`)
    }
  }

  let keepaliveTimer: number | NodeJS.Timeout | null = null

  function startKeepalive(projectPath: string, agentType: AgentType) {
    stopKeepalive()

    const handleKeepaliveResult = (success: boolean) => {
      if (!success) {
        logStatus(`Session lost - keepalive failed. Click Start to reconnect.`)
        // Session is gone, clean up client state
        if (socket.value) {
          socket.value.disconnect()
          socket.value = null
        }
        isConnected.value = false
        connectionState.value = 'idle'
        connectedAgentType.value = null
        stopKeepalive()
      }
    }

    // Initial call
    trpcWatchdog.watchdog.keepalive.mutate({ projectPath, agentType })
      .then((result) => handleKeepaliveResult(result.success))
      .catch((e: Error) => {
        logStatus(`Keepalive initial call failed: ${e.message}`)
      })

    keepaliveTimer = setInterval(async () => {
       try {
         const result = await trpcWatchdog.watchdog.keepalive.mutate({ projectPath, agentType });
         handleKeepaliveResult(result.success);
       } catch (e: any) {
         logStatus(`Keepalive loop failed: ${e.message}`)
       }
    }, 30 * 1000); // 30s
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer)
        keepaliveTimer = null
    }
  }

  async function fetchSessions() {
    try {
      sessions.value = await trpcWatchdog.watchdog.list.query()
      const projectStore = useProjectStore()
      if (projectStore.projectPath) {
        await hydrateAutonomyPolicy(projectStore.projectPath)
        await hydrateRuntimeState(projectStore.projectPath)
      }
      // console.log(`[WatchdogStore] Fetched sessions:`, sessions.value)
    } catch (e: any) {
      logStatus(`Failed to fetch sessions: ${e.message}`)
    }
  }

  function findSession(projectPath: string, agentType: AgentType): WatchdogSession | null {
    const normalizedProjectPath = normalizeProjectPathForSession(projectPath)

    return sessions.value.find((session) =>
      normalizeProjectPathForSession(session.projectPath) === normalizedProjectPath &&
      session.agentType === agentType
    ) || null
  }

  function connectToSocket(port: number, projectPath: string, agentType: AgentType) {
    logStatus(`Connecting to port ${port}...`)

    connectionState.value = 'connecting'
    connectedAgentType.value = agentType
    setAgentType(agentType)
    socket.value = io(buildHttpUrl(port), {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 5000
    })

    setupSocketListeners(projectPath, agentType)
  }

  async function connectToExistingSession(session: WatchdogSession, reason: string) {
    if (socket.value || connectionState.value === 'spawning' || connectionState.value === 'connecting') return false

    logStatus(`${reason} ${session.agentType} session on port ${session.port}...`)
    // Don't clear buffers - preserve existing agent output when reconnecting
    connectToSocket(session.port, session.projectPath, session.agentType)
    return true
  }

  async function connect(overridePath?: string, overrideAgentType?: AgentType) {
    if (socket.value || connectionState.value === 'spawning' || connectionState.value === 'connecting') return

    const projectStore = useProjectStore()
    const targetPath = overridePath || projectStore.projectPath
    const agentType = overrideAgentType || selectedAgentType.value

    if (!targetPath) {
        logStatus('Cannot connect: No project path selected.')
        return
    }

    const existingSession = findSession(targetPath, agentType)
    if (existingSession) {
        await connectToExistingSession(existingSession, 'Connecting to existing')
        return
    }

    connectionState.value = 'spawning'
    logStatus(`Spawning ${agentType} session for path: ${targetPath}...`)

    // Clear only this agent's buffers to avoid duplication/stale data on reconnect
    agentBuffers.value[agentType] = { worker: '', watchdog: '' }

    try {
        // 1. Ask broker to start the process
        const { port } = await trpcWatchdog.watchdog.start.mutate({ projectPath: targetPath, agentType })

        // Update session list to reflect the new process
        await fetchSessions()

        logStatus(`Process spawned.`)
        connectToSocket(port, targetPath, agentType)
    } catch (e: any) {
        logStatus(`Spawn/Connect failed: ${e.message}`)
        connectionState.value = 'error'
        connectedAgentType.value = null
    }
  }

  function disconnect() {
    const projectStore = useProjectStore()
    const projectPath = projectStore.projectPath
    const agentType = connectedAgentType.value || selectedAgentType.value
    if (socket.value) {
      logStatus('Disconnecting from watchdog...')
      socket.value.disconnect()
      socket.value = null
    }
    isConnected.value = false
    connectionState.value = 'idle'
    connectedAgentType.value = null
    supervisorState.value = null
    localStorage.setItem('aimparency-show-watchdog', 'false')
    localStorage.setItem('aimparency-watchdog-should-connect', 'false')
    stopKeepalive()
    if (projectPath) {
      void hydrateRuntimeState(projectPath, agentType)
    }
  }

  function disconnectForProjectSwitch() {
    if (socket.value) {
      logStatus('Disconnecting watchdog due to project switch...')
      socket.value.disconnect()
      socket.value = null
    }
    stopKeepalive()
    isConnected.value = false
    connectionState.value = 'idle'
    connectedAgentType.value = null
    supervisorState.value = null
  }

  async function cancelConnectionAttempt() {
    const projectStore = useProjectStore()
    const projectPath = projectStore.projectPath
    const agentType = connectedAgentType.value || selectedAgentType.value

    if (socket.value) {
      socket.value.removeAllListeners()
      socket.value.disconnect()
      socket.value = null
    }

    stopKeepalive()
    isConnected.value = false
    connectionState.value = 'idle'
    connectedAgentType.value = null
    supervisorState.value = null
    logStatus('Cancelled watchdog connection attempt.')

    if (projectPath) {
      try {
        const status = await trpcWatchdog.watchdog.getStatus.query({
          projectPath,
          agentType
        })
        if (!status.running) {
          await fetchSessions()
        }
      } catch (e: any) {
        logStatus(`Failed to refresh watchdog status after cancel: ${e.message}`)
      }
      await hydrateRuntimeState(projectPath, agentType)
    }
  }

  function toggle() {
    if (!socket.value) return
    const newState = !isEnabled.value
    logStatus(`${newState ? 'Enabling' : 'Disabling'} watchdog...`)
    socket.value.emit('toggle-watchdog', newState)
  }

  function sendWorkerInput(data: string) {
    socket.value?.emit('worker-input', data)
  }

  function sendWatchdogInput(data: string) {
    socket.value?.emit('watchdog-input', data)
  }

  async function stop() {
    const projectStore = useProjectStore()
    if (!projectStore.projectPath) return

    const agentType = connectedAgentType.value || selectedAgentType.value
    logStatus(`Stopping ${agentType} session...`)

    // Disconnect first if connected
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
      isConnected.value = false
    }
    stopKeepalive()

    try {
      await trpcWatchdog.watchdog.stop.mutate({
        projectPath: projectStore.projectPath,
        agentType
      })
      logStatus(`Session stopped.`)
      connectionState.value = 'idle'
      connectedAgentType.value = null
      supervisorState.value = null
      localStorage.setItem('aimparency-watchdog-should-connect', 'false')
      // Refresh session list
      await fetchSessions()
      await hydrateRuntimeState(projectStore.projectPath, agentType)
    } catch (e: any) {
      logStatus(`Stop failed: ${e.message}`)
    }
  }

  async function relaunch() {
    const projectStore = useProjectStore()
    if (!projectStore.projectPath) return

    const agentType = connectedAgentType.value || selectedAgentType.value
    logStatus(`Relaunching ${agentType} session...`)
    stopKeepalive()

    if (socket.value) {
        socket.value.disconnect()
        socket.value = null
        isConnected.value = false
    }

    connectionState.value = 'spawning'
    // Clear only this agent's buffers for fresh start
    agentBuffers.value[agentType] = { worker: '', watchdog: '' }

    try {
        const { port } = await trpcWatchdog.watchdog.relaunch.mutate({
            projectPath: projectStore.projectPath,
            agentType
        })

        // Update session list
        await fetchSessions()

        logStatus('Relaunched.')
        connectToSocket(port, projectStore.projectPath, agentType)

    } catch (e: any) {
        logStatus(`Relaunch failed: ${e.message}`)
        connectionState.value = 'error'
        connectedAgentType.value = null
        supervisorState.value = null
    }
  }

  async function restorePreviousConnection() {
    const projectStore = useProjectStore()
    const projectPath = projectStore.projectPath
    if (!projectPath) return false

    await hydrateAutonomyPolicy(projectPath)
    await hydrateRuntimeState(projectPath)
    if (autonomyPolicy.value && !autonomyPolicy.value.autoConnectToExistingSession) {
      return false
    }

    const selectedSession = currentProjectSession.value
    if (selectedSession) {
      return connectToExistingSession(selectedSession, 'Restoring existing')
    }

    const projectSessions = getSessionsForProject(projectPath)
    if (projectSessions.length !== 1) return false

    const session = projectSessions[0]
    if (!session) return false
    setAgentType(session.agentType)
    return connectToExistingSession(session, 'Restoring detected')
  }

  async function handleProjectSwitch(newProjectPath: string, oldProjectPath?: string) {
    const normalizedNewPath = normalizeProjectPathForSession(newProjectPath || '')
    const normalizedOldPath = normalizeProjectPathForSession(oldProjectPath || '')

    if (normalizedNewPath === normalizedOldPath) return

    const shouldReconnect =
      !!socket.value ||
      localStorage.getItem('aimparency-watchdog-should-connect') === 'true'

    disconnectForProjectSwitch()

    if (!newProjectPath) {
      runtimeMetadata.value = null
      autonomyPolicy.value = null
      isEnabled.value = false
      isEmergencyStopped.value = false
      stopReason.value = ''
      return
    }

    await fetchSessions()

    if (shouldReconnect) {
      await restorePreviousConnection()
    }
  }

  async function hydrateRuntimeState(overridePath?: string, overrideAgentType?: AgentType) {
    const projectStore = useProjectStore()
    const projectPath = overridePath || projectStore.projectPath
    if (!projectPath) return null

    try {
      const runtimeState = await trpc.project.getWatchdogRuntimeState.query({
        projectPath
      }) as WatchdogRuntimeState

      // Store the runtime metadata for UI display
      runtimeMetadata.value = runtimeState

      const storedAgentType = localStorage.getItem('aimparency-agent-type') as AgentType | null
      if (!storedAgentType && runtimeState.preferredAgentType) {
        selectedAgentType.value = runtimeState.preferredAgentType
        localStorage.setItem('aimparency-agent-type', runtimeState.preferredAgentType)
      }

      if (!isConnected.value) {
        const agentType = overrideAgentType || selectedAgentType.value
        const agentState = runtimeState.agents[agentType]
        isEnabled.value = agentState?.enabled ?? false
        isEmergencyStopped.value = agentState?.emergencyStopped ?? false
        stopReason.value = agentState?.stopReason ?? ''
        supervisorState.value = null
      }

      return runtimeState
    } catch (e: any) {
      logStatus(`Failed to hydrate watchdog runtime state: ${e.message}`)
      return null
    }
  }

  async function hydrateAutonomyPolicy(overridePath?: string) {
    const projectStore = useProjectStore()
    const projectPath = overridePath || projectStore.projectPath
    if (!projectPath) return null

    try {
      const policy = await trpc.project.getAutonomyPolicy.query({
        projectPath
      }) as AutonomyPolicy
      autonomyPolicy.value = policy
      return policy
    } catch (e: any) {
      logStatus(`Failed to hydrate autonomy policy: ${e.message}`)
      return null
    }
  }

  function triggerWorkerFocus() {
    focusRequestCounter.value++
  }

  function setupSocketListeners(projectPath: string, agentType: AgentType) {
    if (!socket.value) return

    socket.value.on('connect', () => {
      logStatus('WebSocket connected successfully.')
      isConnected.value = true
      connectionState.value = 'connected'
      localStorage.setItem('aimparency-watchdog-should-connect', 'true')
      startKeepalive(projectPath, agentType)
    })

    socket.value.on('connect_error', (err) => {
      logStatus(`WebSocket connection error: ${err.message}. (Retrying...)`)
      isConnected.value = false
      if (connectionState.value !== 'error') connectionState.value = 'connecting'
    })

    socket.value.on('reconnect_attempt', (attempt) => {
      logStatus(`Reconnection attempt #${attempt}...`)
    })

    socket.value.on('reconnect_failed', () => {
      logStatus('WebSocket reconnection failed after all attempts.')
      void cancelConnectionAttempt().then(() => {
        connectionState.value = 'error'
      })
    })

    socket.value.on('disconnect', (reason) => {
      logStatus(`WebSocket disconnected: ${reason}`)
      isConnected.value = false
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          connectionState.value = 'idle'
      } else {
          connectionState.value = 'connecting'
      }
    })

    socket.value.on('watchdog-state', (enabled: boolean) => {
      isEnabled.value = enabled
      logStatus(`Watchdog is now ${enabled ? 'ENABLED' : 'DISABLED'}`)
      if (enabled) {
        stopReason.value = ''
        isEmergencyStopped.value = false
      }
    })

    socket.value.on('emergency-state', (stopped: boolean) => {
      isEmergencyStopped.value = stopped
      if (stopped) {
          logStatus('Emergency Stop triggered.')
          if (!stopReason.value) stopReason.value = 'Emergency Stop'
      }
    })

    socket.value.on('emergency-stop', () => {
      logStatus('Received emergency-stop signal.')
      isEmergencyStopped.value = true
      isEnabled.value = false
      stopReason.value = 'Emergency Stop'
    })

    socket.value.on('watchdog-stop-reason', (reason: string) => {
      logStatus(`Watchdog stopped. Reason: ${reason}`)
      stopReason.value = reason
    })

    socket.value.on('animator-state', (state: AnimatorStateInfo) => {
      supervisorState.value = state
    })

    // Data handling - write to specific agent's buffer using closure-captured agentType
    socket.value.on('worker-data', (data: string) => {
      agentBuffers.value[agentType].worker += data
      if (agentBuffers.value[agentType].worker.length > 100000) {
        agentBuffers.value[agentType].worker = agentBuffers.value[agentType].worker.slice(-100000)
      }
    })

    socket.value.on('watchdog-data', (data: string) => {
      agentBuffers.value[agentType].watchdog += data
      if (agentBuffers.value[agentType].watchdog.length > 100000) {
        agentBuffers.value[agentType].watchdog = agentBuffers.value[agentType].watchdog.slice(-100000)
      }
    })
  }

  return {
    socket,
    isConnected,
    connectionState,
    isEnabled,
    isEmergencyStopped,
    stopReason,
    supervisorState,
    workerOutput,
    watchdogOutput,
    spawningLog,
    showActionsOverlay,
    focusRequestCounter,
    autonomyPolicy,
    runtimeMetadata,
    sessions,
    selectedAgentType,
    connectedAgentType,
    currentProjectSession,
    setAgentType,
    fetchSessions,
    connect,
    cancelConnectionAttempt,
    disconnect,
    stop,
    toggle,
    sendWorkerInput,
    sendWatchdogInput,
    relaunch,
    triggerWorkerFocus,
    restorePreviousConnection,
    handleProjectSwitch,
    hydrateRuntimeState,
    hydrateAutonomyPolicy
  }
})
