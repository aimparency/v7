import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import { ref } from 'vue'
import { trpc } from '../trpc'
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
  
  let keepaliveTimer: number | NodeJS.Timeout | null = null

  function startKeepalive() {
    stopKeepalive()
    const uiStore = useUIStore()
    
    // Initial call
    if (uiStore.projectPath) {
        trpc.watchdog.keepalive.mutate({ projectPath: uiStore.projectPath }).catch(console.error)
    }

    keepaliveTimer = setInterval(async () => {
       if (uiStore.projectPath) {
         try {
           await trpc.watchdog.keepalive.mutate({ projectPath: uiStore.projectPath });
         } catch (e) {
           console.warn("Watchdog keepalive failed", e);
         }
       }
    }, 30 * 1000); // 30s
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer)
        keepaliveTimer = null
    }
  }

  async function connect() {
    if (socket.value) return

    const uiStore = useUIStore()
    if (!uiStore.projectPath) {
        console.warn('Cannot connect watchdog: No project path')
        return
    }

    try {
        // Lazy spawn via backend
        const { port } = await trpc.watchdog.start.mutate({ projectPath: uiStore.projectPath })
        
        startKeepalive() // Start keepalive loop

        const watchdogUrl = `http://localhost:${port}` 

        socket.value = io(watchdogUrl, {
          transports: ['websocket'],
          autoConnect: true
        })

        socket.value.on('connect', () => {
          console.log('Connected to Watchdog')
          isConnected.value = true
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
          // Trim buffer if too long?
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
    } catch (e) {
        console.error('Failed to spawn/connect watchdog:', e)
    }
  }

  function toggle() {
    if (!socket.value) return
    const newState = !isEnabled.value
    socket.value.emit('toggle-watchdog', newState)
  }

  function sendWorkerInput(data: string) {
    socket.value?.emit('worker-input', data)
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
        await trpc.watchdog.stop.mutate({ projectPath: uiStore.projectPath })
        await new Promise(resolve => setTimeout(resolve, 1000))
        await connect()
    } catch (e) {
        console.error('Failed to relaunch watchdog:', e)
    }
  }

  return {
    socket,
    isConnected,
    isEnabled,
    isEmergencyStopped,
    stopReason,
    workerOutput,
    watchdogOutput,
    connect,
    toggle,
    sendWorkerInput,
    relaunch
  }
})
