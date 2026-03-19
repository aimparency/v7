import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { ref, computed } from 'vue'
import { trpcWatchdog } from '../trpc-watchdog'
import { buildHttpUrl } from '../utils/runtime-config'
import { useProjectStore } from './project-store'

export type AgentType = 'claude' | 'gemini' | 'codex'

export const useWatchdogStore = defineStore('watchdog', () => {
  const socket = ref<Socket | null>(null)
  const isConnected = ref(false)
  const connectionState = ref<'idle' | 'spawning' | 'connecting' | 'connected' | 'error'>('idle')
  const isEnabled = ref(false)
  const isEmergencyStopped = ref(false)
  const stopReason = ref('')
  const showActionsOverlay = ref(false)
  const focusRequestCounter = ref(0)

  // Agent type selection with localStorage persistence
  const storedAgentType = localStorage.getItem('aimparency-agent-type') as AgentType | null
  const selectedAgentType = ref<AgentType>(storedAgentType || 'claude')

  // Track which agent type we're currently connected to
  const connectedAgentType = ref<AgentType | null>(null)

  // Terminal buffers
  const workerOutput = ref('')
  const watchdogOutput = ref('')
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
  const shouldRestoreConnection = () => localStorage.getItem('aimparency-watchdog-should-connect') === 'true'

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
    logStatus(`Starting keepalive and connecting to port ${port}...`)
    startKeepalive(projectPath, agentType)

    connectionState.value = 'connecting'
    connectedAgentType.value = agentType
    socket.value = io(buildHttpUrl(port), {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 5000
    })

    setupSocketListeners()
  }

  async function connectToExistingSession(session: WatchdogSession, reason: string) {
    if (socket.value || connectionState.value === 'spawning' || connectionState.value === 'connecting') return false

    logStatus(`${reason} ${session.agentType} session on port ${session.port}...`)
    workerOutput.value = ''
    watchdogOutput.value = ''
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
    
    // Clear buffers to avoid duplication/stale data on reconnect
    workerOutput.value = ''
    watchdogOutput.value = ''

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
    if (socket.value) {
      logStatus('Disconnecting from watchdog...')
      socket.value.disconnect()
      socket.value = null
    }
    isConnected.value = false
    connectionState.value = 'idle'
    connectedAgentType.value = null
    localStorage.setItem('aimparency-show-watchdog', 'false')
    localStorage.setItem('aimparency-watchdog-should-connect', 'false')
    stopKeepalive()
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
      localStorage.setItem('aimparency-watchdog-should-connect', 'false')
      // Refresh session list
      await fetchSessions()
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
    // Clear buffers for fresh start
    workerOutput.value = ''
    watchdogOutput.value = ''

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
    }
  }

  async function restorePreviousConnection() {
    if (!shouldRestoreConnection()) return false

    const session = currentProjectSession.value
    if (!session) return false

    return connectToExistingSession(session, 'Restoring previous')
  }

  function triggerWorkerFocus() {
    focusRequestCounter.value++
  }

  function setupSocketListeners() {
    if (!socket.value) return

    socket.value.on('connect', () => {
      logStatus('WebSocket connected successfully.')
      isConnected.value = true
      connectionState.value = 'connected'
      localStorage.setItem('aimparency-watchdog-should-connect', 'true')
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
      connectionState.value = 'error'
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

    // Data handling
    socket.value.on('worker-data', (data: string) => {
      workerOutput.value += data
      if (workerOutput.value.length > 100000) {
        workerOutput.value = workerOutput.value.slice(-100000)
      }
    })

    socket.value.on('watchdog-data', (data: string) => {
      watchdogOutput.value += data
      if (watchdogOutput.value.length > 100000) {
        watchdogOutput.value = watchdogOutput.value.slice(-100000)
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
    workerOutput,
    watchdogOutput,
    spawningLog,
    showActionsOverlay,
    focusRequestCounter,
    sessions,
    selectedAgentType,
    connectedAgentType,
    currentProjectSession,
    setAgentType,
    fetchSessions,
    connect,
    disconnect,
    stop,
    toggle,
    sendWorkerInput,
    sendWatchdogInput,
    relaunch,
    triggerWorkerFocus,
    restorePreviousConnection
  }
})
