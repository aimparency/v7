import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { ref } from 'vue'
import { trpcWatchdog } from '../trpc-watchdog'
import { useUIStore } from './ui'

export const useWatchdogStore = defineStore('watchdog', () => {
  const socket = ref<Socket | null>(null)
  const isConnected = ref(false)
  const connectionState = ref<'idle' | 'spawning' | 'connecting' | 'connected' | 'error'>('idle')
  const isEnabled = ref(false)
  const isEmergencyStopped = ref(false)
  const stopReason = ref('')
  const showActionsOverlay = ref(false)
  
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
    lastKeepalive: number
  }
  const sessions = ref<WatchdogSession[]>([])

  let keepaliveTimer: number | NodeJS.Timeout | null = null

  function startKeepalive(projectPath: string) {
    stopKeepalive()
    
    // Initial call
    trpcWatchdog.watchdog.keepalive.mutate({ projectPath }).catch((e: Error) => {
        logStatus(`Keepalive initial call failed: ${e.message}`)
    })

    keepaliveTimer = setInterval(async () => {
       try {
         await trpcWatchdog.watchdog.keepalive.mutate({ projectPath });
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
    } catch (e: any) {
      logStatus(`Failed to fetch sessions: ${e.message}`)
    }
  }

  async function connect(overridePath?: string) {
    if (socket.value || connectionState.value === 'spawning' || connectionState.value === 'connecting') return

    const uiStore = useUIStore()
    const targetPath = overridePath || uiStore.projectPath

    if (!targetPath) {
        logStatus('Cannot connect: No project path selected.')
        return
    }

    connectionState.value = 'spawning'
    logStatus(`Spawning watchdog process for path: ${targetPath}...`)

    try {
        // 1. Ask broker to start the process
        const { port } = await trpcWatchdog.watchdog.start.mutate({ projectPath: targetPath })
        
        logStatus(`Process spawned. Starting keepalive and connecting to port ${port}...`)
        startKeepalive(targetPath)

        connectionState.value = 'connecting'
        const watchdogUrl = `http://localhost:${port}` 

        // 2. Connect with automatic reconnection
        socket.value = io(watchdogUrl, {
          transports: ['websocket'],
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          timeout: 5000
        })

        setupSocketListeners()
    } catch (e: any) {
        logStatus(`Spawn/Connect failed: ${e.message}`)
        connectionState.value = 'error'
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

  async function relaunch() {
    const uiStore = useUIStore()
    if (!uiStore.projectPath) return

    logStatus('Relaunching watchdog process...')
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
        const { port } = await trpcWatchdog.watchdog.relaunch.mutate({ projectPath: uiStore.projectPath })
        
        logStatus(`Relaunched. Connecting to port ${port}...`)
        startKeepalive(uiStore.projectPath)

        connectionState.value = 'connecting'
        const watchdogUrl = `http://localhost:${port}`
        socket.value = io(watchdogUrl, {
          transports: ['websocket'],
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000
        })

        setupSocketListeners()
        
    } catch (e: any) {
        logStatus(`Relaunch failed: ${e.message}`)
        connectionState.value = 'error'
    }
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
    sessions,
    fetchSessions,
    connect,
    disconnect,
    toggle,
    sendWorkerInput,
    sendWatchdogInput,
    relaunch
  }
})
