import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { ref } from 'vue'
import { trpcWatchdog } from '../trpc-watchdog'
import { useUIStore } from './ui'

export const useWatchdogStore = defineStore('watchdog', () => {
  const socket = ref<Socket | null>(null)
  const isConnected = ref(false)
  const isEnabled = ref(false)
  const isEmergencyStopped = ref(false)
  const stopReason = ref('')
  
  // Terminal buffers
  const workerOutput = ref('')
  const watchdogOutput = ref('')
  
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
    trpcWatchdog.watchdog.keepalive.mutate({ projectPath }).catch(console.error)

    keepaliveTimer = setInterval(async () => {
       try {
         await trpcWatchdog.watchdog.keepalive.mutate({ projectPath });
       } catch (e) {
         console.warn("Watchdog keepalive failed", e);
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
    } catch (e) {
      console.error('Failed to fetch watchdog sessions', e)
    }
  }

  async function connect(overridePath?: string) {
    if (socket.value) return

    const uiStore = useUIStore()
    const targetPath = overridePath || uiStore.projectPath

    if (!targetPath) {
        console.warn('Cannot connect watchdog: No project path')
        return
    }

    try {
        // Lazy spawn via backend
        const { port } = await trpcWatchdog.watchdog.start.mutate({ projectPath: targetPath })
        
        startKeepalive(targetPath) // Start keepalive loop

        const watchdogUrl = `http://localhost:${port}` 

        socket.value = io(watchdogUrl, {
          transports: ['websocket'],
          autoConnect: true
        })

        setupSocketListeners()
    } catch (e) {
        console.error('Failed to spawn/connect watchdog:', e)
    }
  }

  function disconnect() {
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
    }
    isConnected.value = false
    localStorage.setItem('aimparency-watchdog-should-connect', 'false')
    stopKeepalive()
  }

  function toggle() {
    if (!socket.value) return
    const newState = !isEnabled.value
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

    stopKeepalive()

    if (socket.value) {
        socket.value.disconnect()
        socket.value = null
        isConnected.value = false
    }

    try {
        const { port } = await trpcWatchdog.watchdog.relaunch.mutate({ projectPath: uiStore.projectPath })
        
        startKeepalive(uiStore.projectPath)

        const watchdogUrl = `http://localhost:${port}`
        socket.value = io(watchdogUrl, {
          transports: ['websocket'],
          autoConnect: true
        })

        setupSocketListeners()
        
    } catch (e) {
        console.error('Failed to relaunch watchdog:', e)
    }
  }

  function setupSocketListeners() {
    if (!socket.value) return

    socket.value.on('connect', () => {
      console.log('Connected to Watchdog')
      isConnected.value = true
      localStorage.setItem('aimparency-watchdog-should-connect', 'true')
    })

    socket.value.on('connect_error', (err) => {
      console.error('Watchdog connection error:', err)
    })

    socket.value.on('disconnect', () => {
      console.log('Disconnected from Watchdog')
      isConnected.value = false
    })

    socket.value.on('watchdog-state', (enabled: boolean) => {
      isEnabled.value = enabled
      if (enabled) {
        stopReason.value = ''
        isEmergencyStopped.value = false
      }
    })

    socket.value.on('emergency-state', (stopped: boolean) => {
      isEmergencyStopped.value = stopped
      if (stopped && !stopReason.value) stopReason.value = 'Emergency Stop'
    })

    socket.value.on('emergency-stop', () => {
      isEmergencyStopped.value = true
      isEnabled.value = false
      stopReason.value = 'Emergency Stop'
    })

    socket.value.on('watchdog-stop-reason', (reason: string) => {
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
    isEnabled,
    isEmergencyStopped,
    stopReason,
    workerOutput,
    watchdogOutput,
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
