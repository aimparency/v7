<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useWatchdogStore } from '../stores/watchdog'
import WatchdogTerminal from './WatchdogTerminal.vue'

const store = useWatchdogStore()
const workerTerm = ref<InstanceType<typeof WatchdogTerminal>>()
const watchdogTerm = ref<InstanceType<typeof WatchdogTerminal>>()

const selectedSession = ref('')
const isCreating = ref(false)
const newProjectPath = ref('')

const onSessionSelect = () => {
    if (selectedSession.value === '__new__') {
        isCreating.value = true
        selectedSession.value = ''
    } else if (selectedSession.value) {
        store.connect(selectedSession.value)
        selectedSession.value = ''
    }
}

const connectNew = () => {
    if (newProjectPath.value) {
        store.connect(newProjectPath.value)
        isCreating.value = false
        newProjectPath.value = ''
    }
}

const onWorkerData = (data: string) => workerTerm.value?.write(data)
const onWatchdogData = (data: string) => watchdogTerm.value?.write(data)

// Manage socket listeners manually to prevent leaks and ensure data flow to terminals
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

onMounted(() => {
  store.fetchSessions()
  const shouldConnect = localStorage.getItem('aimparency-watchdog-should-connect')
  if (shouldConnect !== 'false') {
    store.connect()
  }
})

onUnmounted(() => {
  if (store.socket) {
    store.socket.off('worker-data', onWorkerData)
    store.socket.off('watchdog-data', onWatchdogData)
  }
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
</script>

<template>
  <div class="watchdog-panel">
    <div class="panel-header">
      <div class="status-indicator">
        <span class="dot" :class="{ connected: store.isConnected }"></span>
        <span class="status-text">{{ store.isConnected ? 'Connected' : 'Disconnected' }}</span>
        
        <div class="connection-control" v-if="!store.isConnected">
            <select v-model="selectedSession" @change="onSessionSelect" class="session-select">
                <option value="" disabled selected>Select Session...</option>
                <option v-for="s in store.sessions" :key="s.projectPath" :value="s.projectPath">
                    {{ s.projectPath.split('/').pop() === '.bowman' ? s.projectPath.split('/').slice(-2, -1)[0] : s.projectPath.split('/').pop() }} ({{ s.pid }})
                </option>
                <option value="__new__">+ New Session...</option>
            </select>
            <input 
                v-if="isCreating" 
                v-model="newProjectPath" 
                @keyup.enter="connectNew"
                placeholder="Project Path" 
                class="path-input"
            />
            <button v-if="isCreating" @click="connectNew" class="link-btn">Go</button>
            <button v-else @click="store.connect()" class="link-btn" title="Connect to current project">(Current)</button>
            <button @click="store.fetchSessions()" class="refresh-btn" title="Refresh Sessions">↻</button>
        </div>
        <button 
          v-else 
          @click="store.disconnect()" 
          class="link-btn" 
          title="Disconnect from backend"
        >(Disconnect)</button>
      </div>
      <div class="controls">
        <span v-if="store.stopReason" class="stop-reason">{{ store.stopReason }}</span>
        <button 
          @click="toggle" 
          class="toggle-btn"
          :class="{ running: store.isEnabled }"
          :disabled="!store.isConnected"
        >
          {{ store.isEnabled ? 'Disable Watchdog' : 'Enable Watchdog' }}
        </button>
        <button 
          @click="store.relaunch()" 
          class="relaunch-btn"
          title="Restart the underlying Watchdog process"
        >
          Relaunch
        </button>
      </div>
    </div>
    
    <div class="terminals">
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
        <div class="term-label">Watchdog (Brain)</div>
        <WatchdogTerminal 
          ref="watchdogTerm" 
          :initial-content="store.watchdogOutput"
          :onData="handleWatchdogInput"
          @resize="(dims) => store.socket?.emit('resize-watchdog', dims)"
        />
      </div>
    </div>
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

.connection-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.session-select {
    background: #333;
    color: #ccc;
    border: 1px solid #555;
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    font-size: 0.8rem;
    max-width: 150px;
}

.path-input {
    background: #333;
    color: #ccc;
    border: 1px solid #555;
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    font-size: 0.8rem;
    width: 200px;
}

.refresh-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
}
.refresh-btn:hover {
    color: #fff;
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
</style>
