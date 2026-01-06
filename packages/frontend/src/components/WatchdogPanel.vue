<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useWatchdogStore } from '../stores/watchdog'
import { useUIStore } from '../stores/ui'
import WatchdogTerminal from './WatchdogTerminal.vue'
import WatchdogActionsOverlay from './WatchdogActionsOverlay.vue'

const store = useWatchdogStore()
const uiStore = useUIStore()
const workerTerm = ref<InstanceType<typeof WatchdogTerminal>>()
const watchdogTerm = ref<InstanceType<typeof WatchdogTerminal>>()

const onWorkerData = (data: string) => workerTerm.value?.write(data)
const onWatchdogData = (data: string) => watchdogTerm.value?.write(data)

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault()
    e.stopPropagation()
    store.showActionsOverlay = !store.showActionsOverlay
  }

  // Ctrl+Shift+A: Search Aim and Insert
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
    e.preventDefault()
    e.stopPropagation()
    uiStore.openAimSearch('pick', (aim) => {
      // Insert [ID] Title into worker terminal
      const textToInsert = `[${aim.id}] ${aim.text}`
      store.sendWorkerInput(textToInsert)
    })
  }
}

// Manage socket listeners manually to prevent filtered data
watch(() => store.socket, (socket, oldSocket) => {
  if (oldSocket) {
    oldSocket.off('worker-data', onWorkerData)
    oldSocket.off('watchdog-data', onWatchdogData)
  }
  if (socket) {
    socket.on('worker-data', onWorkerData)
    socket.on('watchdog-data', onWatchdogData)
  }
}, { immediate: true })

watch(() => store.focusRequestCounter, () => {
  // Allow UI updates (e.g. search modal closing) to complete before focusing
  setTimeout(() => {
    workerTerm.value?.focus()
  }, 50)
})

onMounted(() => {
  store.fetchSessions()
  const shouldConnect = localStorage.getItem('aimparency-watchdog-should-connect')
  if (shouldConnect !== 'false') {
    store.connect()
  }
  window.addEventListener('keydown', handleKeyDown, true) // Capture phase
})

onUnmounted(() => {
  if (store.socket) {
    store.socket.off('worker-data', onWorkerData)
    store.socket.off('watchdog-data', onWatchdogData)
  }
  window.removeEventListener('keydown', handleKeyDown, true)
})

const handleWorkerInput = (data: string) => {
  store.sendWorkerInput(data)
}

const handleWatchdogInput = (data: string) => {
  store.sendWatchdogInput(data)
}

const toggle = () => {
  store.toggle()
}

const focusWorker = () => {
  workerTerm.value?.focus()
}

defineExpose({
  focusWorker
})
</script>

<template>
  <div class="watchdog-panel">
    <div class="panel-header">
      <div class="status-indicator">
        <span class="dot" :class="{ 
          connected: store.isConnected, 
          connecting: store.connectionState === 'connecting' || store.connectionState === 'spawning',
          error: store.connectionState === 'error'
        }"></span>
        <span class="status-text">
          <template v-if="store.connectionState === 'idle'">Disconnected</template>
          <template v-else-if="store.connectionState === 'spawning'">Spawning Process...</template>
          <template v-else-if="store.connectionState === 'connecting'">Connecting to Socket...</template>
          <template v-else-if="store.connectionState === 'connected'">Connected</template>
          <template v-else-if="store.connectionState === 'error'">Connection Error</template>
        </span>
        <button 
          v-if="store.isConnected" 
          @click="store.disconnect()" 
          class="link-btn" 
          title="Disconnect from backend"
        >(Disconnect)</button>
        <button 
          v-else 
          @click="store.connect()" 
          class="link-btn" 
          title="Connect to backend"
          :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
        >(Connect)</button>
      </div>
      <div class="controls">
        <span v-if="store.stopReason" class="stop-reason">{{ store.stopReason }}</span>
        <button 
          @click="toggle" 
          class="toggle-btn"
          :class="{ running: store.isEnabled }"
          :disabled="!store.isConnected"
        >
          {{ store.isEnabled ? 'Disable Animator' : 'Enable Animator' }}
        </button>
        <button 
          @click="store.relaunch()" 
          class="relaunch-btn"
          title="Restart the underlying Watchdog process"
          :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
        >
          Relaunch
        </button>
      </div>
    </div>
    
    <div class="terminals" v-show="store.isConnected">
      <div class="term-col">
        <div class="term-label">Worker (Main Agent)</div>
        <WatchdogTerminal 
          ref="workerTerm" 
          :initial-content="store.workerOutput"
          :onData="handleWorkerInput"
          @resize="(dims) => store.socket?.emit('resize-worker', dims)"
        />
      </div>
      <div class="term-col">
        <div class="term-label">Watchdog (Animator)</div>
        <WatchdogTerminal 
          ref="watchdogTerm" 
          :initial-content="store.watchdogOutput"
          :onData="handleWatchdogInput"
          @resize="(dims) => store.socket?.emit('resize-watchdog', dims)"
        />
      </div>
    </div>

    <!-- Informative Log when not connected -->
    <div v-if="!store.isConnected" class="spawning-log">
      <div class="log-title">Connection Status Log:</div>
      <div v-for="(log, i) in store.spawningLog" :key="i" class="log-entry">
        {{ log }}
      </div>
      <div v-if="store.connectionState === 'error'" class="error-hint">
        Check backend logs or try Relaunching.
      </div>
    </div>

    <!-- Actions Overlay -->
    <WatchdogActionsOverlay v-if="store.showActionsOverlay" />
  </div>
</template>

<style scoped>
.watchdog-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-top: 1px solid #333;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: #252526;
  border-bottom: 1px solid #333;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #ccc;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
}

.dot.connected {
  background: #00aa00;
}

.dot.connecting {
  background: #fa0;
  animation: blink 1s infinite;
}

.dot.error {
  background: #d32f2f;
}

@keyframes blink {
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
}

.status-text {
  min-width: 120px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stop-reason {
  color: #fa0;
  font-weight: bold;
  font-size: 0.8rem;
}

.link-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 0.75rem;
  text-decoration: underline;
  padding: 0;
  margin-left: 0.5rem;
}

.link-btn:hover {
  color: #aaa;
}

.link-btn:disabled {
  text-decoration: none;
  cursor: default;
}

.toggle-btn {
  background: #007acc;
  color: white;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8rem;
}

.toggle-btn:disabled {
  background: #444;
  cursor: not-allowed;
}

.toggle-btn.running {
  background: #d32f2f;
}

.relaunch-btn {
  background: transparent;
  border: 1px solid #555;
  color: #ccc;
  padding: 0.25rem 0.75rem;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8rem;
}

.relaunch-btn:hover {
  background: #333;
  color: #fff;
}

.relaunch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.terminals {
  flex: 1;
  display: flex;
  min-height: 0;
}

.term-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid #333;
}

.term-col:last-child {
  border-right: none;
}

.term-label {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  color: #888;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
}

.spawning-log {
  flex: 1;
  padding: 1rem;
  font-family: monospace;
  font-size: 0.8rem;
  color: #aaa;
  overflow-y: auto;
  background: #1a1a1a;
}

.log-title {
  color: #666;
  margin-bottom: 0.5rem;
  font-weight: bold;
}

.log-entry {
  margin-bottom: 0.2rem;
}

.error-hint {
  margin-top: 1rem;
  color: #f44;
  font-weight: bold;
}
</style>
