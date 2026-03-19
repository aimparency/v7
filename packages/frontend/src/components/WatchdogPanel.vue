<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { useWatchdogStore, type AgentType } from '../stores/watchdog'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import WatchdogTerminal from './WatchdogTerminal.vue'
import WatchdogActionsOverlay from './WatchdogActionsOverlay.vue'

const store = useWatchdogStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()
const workerTerm = ref<InstanceType<typeof WatchdogTerminal>>()
const watchdogTerm = ref<InstanceType<typeof WatchdogTerminal>>()

const onWorkerData = (data: string) => workerTerm.value?.write(data)
const onWatchdogData = (data: string) => watchdogTerm.value?.write(data)

// Computed: is a session running for the selected agent type?
const sessionExists = computed(() => store.currentProjectSession !== null)

// Computed: are we connected to the selected agent type?
const isConnectedToSelected = computed(() =>
  store.isConnected && store.connectedAgentType === store.selectedAgentType
)

// Header background color based on selected agent type
const headerBgColor = computed(() => {
  if (store.isConnected) {
    if (store.connectedAgentType === 'claude') return '#92400e'
    if (store.connectedAgentType === 'gemini') return '#0e7490'
    return '#0f766e'
  }
  if (store.selectedAgentType === 'claude') return '#78350f'
  if (store.selectedAgentType === 'gemini') return '#164e63'
  return '#115e59'
})

const runningAgents = computed(() => {
  const set = new Set<AgentType>()
  if (!projectStore.projectPath) return set
  
  // Normalize: strip trailing slashes, then .bowman
  const normalize = (p: string) => p.replace(/\/+$/, '').replace(/\/\.bowman$/, '')
  
  const normalizedUiPath = normalize(projectStore.projectPath)

  store.sessions.forEach(s => {
    const normalizedSessionPath = normalize(s.projectPath)
    if (normalizedSessionPath === normalizedUiPath) {
      set.add(s.agentType)
    }
  })
  return set
})

async function onAgentTypeChange(e: Event) {
  const target = e.target as HTMLSelectElement
  const newType = target.value as AgentType

  // If currently connected to a different agent type, disconnect (but leave it running)
  if (store.isConnected && store.connectedAgentType !== newType) {
    store.disconnect()
    // Clear terminals when switching agent types
    workerTerm.value?.clear()
    watchdogTerm.value?.clear()
  }

  // Update the selected type
  store.setAgentType(newType)

  // Wait for computed properties to update
  await nextTick()

  // Auto-connect if session exists for new agent type
  if (store.currentProjectSession !== null && !store.isConnected) {
    await store.connect()
  }
}

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
    modalStore.openAimSearch('pick', (aim) => {
      // Insert [ID] Title into worker terminal
      const textToInsert = `[${aim.id}] ${aim.text}`
      store.sendWorkerInput(textToInsert)
    })
  }
}

// Watch for buffer clears (e.g. on relaunch)
watch(() => store.workerOutput, (newVal) => {
  if (newVal === '') {
    workerTerm.value?.clear()
  }
})

watch(() => store.watchdogOutput, (newVal) => {
  if (newVal === '') {
    watchdogTerm.value?.clear()
  }
})

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
}, { immediate: true, flush: 'sync' })

watch(() => store.focusRequestCounter, () => {
  // Allow UI updates (e.g. search modal closing) to complete before focusing
  setTimeout(() => {
    workerTerm.value?.focus()
  }, 200)
})

watch(() => store.showActionsOverlay, (newValue) => {
  if (!newValue) {
    // Overlay closed - restore focus only if no follow-up modal is active.
    setTimeout(() => {
      if (!modalStore.showAimSearch && !modalStore.showAimModal && !modalStore.showPhaseModal && !modalStore.showSettingsModal) {
        workerTerm.value?.focus()
      }
    }, 100)
  }
})

watch(() => modalStore.showAimSearch, (isOpen, wasOpen) => {
  // If actions overlay launched aim search, restore terminal focus only after search closes.
  if (wasOpen && !isOpen && !store.showActionsOverlay) {
    setTimeout(() => workerTerm.value?.focus(), 80)
  }
})

onMounted(() => {
  void store.fetchSessions().then(() => store.restorePreviousConnection())
  window.addEventListener('keydown', handleKeyDown, true) // Capture phase
})

watch(
  [() => projectStore.projectPath, () => store.currentProjectSession?.port ?? null],
  () => {
    void store.restorePreviousConnection()
  }
)

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
    <div class="panel-header" :style="{ background: headerBgColor }">
      <!-- Left: Agent Selector + Status + Session Controls -->
      <div class="header-left">
        <select
          :value="store.selectedAgentType"
          @change="onAgentTypeChange"
          :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
          class="agent-select"
        >
          <option value="claude">Claude {{ runningAgents.has('claude') ? '(Running)' : '' }}</option>
          <option value="gemini">Gemini {{ runningAgents.has('gemini') ? '(Running)' : '' }}</option>
          <option value="codex">Codex {{ runningAgents.has('codex') ? '(Running)' : '' }}</option>
        </select>

        <span class="session-status">
          <template v-if="isConnectedToSelected">
            <span class="dot connected"></span> Connected
          </template>
          <template v-else-if="store.connectionState === 'spawning' || store.connectionState === 'connecting'">
            <span class="dot connecting"></span> {{ store.connectionState === 'spawning' ? 'Spawning...' : 'Connecting...' }}
          </template>
          <template v-else-if="sessionExists">
            <span class="dot idle"></span> Running
          </template>
          <template v-else>
            <span class="dot"></span> No session
          </template>
        </span>

        <!-- Session state buttons -->
        <div class="session-controls">
          <!-- No session: Start -->
          <button
            v-if="!sessionExists && !store.isConnected"
            @click="store.connect()"
            class="action-btn connect-btn"
            :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
          >
            Start
          </button>

          <!-- Session exists but not connected: Connect -->
          <button
            v-if="sessionExists && !isConnectedToSelected"
            @click="store.connect()"
            class="action-btn connect-btn"
            :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
          >
            Connect
          </button>

          <!-- Connected: Disconnect -->
          <button
            v-if="isConnectedToSelected"
            @click="store.disconnect()"
            class="action-btn disconnect-btn"
          >
            Disconnect
          </button>

          <!-- Session exists (connected or not): Stop + Relaunch -->
          <template v-if="sessionExists || store.isConnected">
            <button
              @click="store.stop()"
              class="action-btn stop-btn"
              :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
            >
              Stop
            </button>
            <button
              @click="store.relaunch()"
              class="action-btn relaunch-btn"
              title="Restart the underlying agent process"
              :disabled="store.connectionState === 'spawning' || store.connectionState === 'connecting'"
            >
              Relaunch
            </button>
          </template>
        </div>
      </div>

      <!-- Right: Animator Toggle + Stop Reason -->
      <div class="header-right">
        <span v-if="store.stopReason" class="stop-reason">{{ store.stopReason }}</span>
        <button
          @click="toggle"
          class="action-btn toggle-btn"
          :class="{ running: store.isEnabled }"
          :disabled="!store.isConnected"
        >
          {{ store.isEnabled ? 'Disable Animator' : 'Enable Animator' }}
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
  border-bottom: 1px solid #333;
  transition: background 0.3s ease;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.session-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.5rem;
  padding-left: 0.75rem;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
}

.agent-select {
  padding: 0.35rem 0.5rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
}

.session-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.8);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
}

.dot.connected {
  background: #22c55e;
}

.dot.connecting {
  background: #fbbf24;
  animation: blink 1s infinite;
}

.dot.idle {
  background: #3b82f6;
}

.dot.error {
  background: #ef4444;
}

@keyframes blink {
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
}

.stop-reason {
  color: #fbbf24;
  font-weight: bold;
  font-size: 0.8rem;
  margin-right: 0.5rem;
}

.action-btn {
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s, background 0.2s;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.connect-btn {
  background: #22c55e;
  color: white;

  &:hover:not(:disabled) {
    background: #16a34a;
  }
}

.disconnect-btn {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.25);
  }
}

.stop-btn {
  background: #dc2626;
  color: white;

  &:hover:not(:disabled) {
    background: #b91c1c;
  }
}

.toggle-btn {
  background: #3b82f6;
  color: white;

  &:hover:not(:disabled) {
    background: #2563eb;
  }

  &.running {
    background: #ef4444;

    &:hover:not(:disabled) {
      background: #dc2626;
    }
  }
}

.relaunch-btn {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }
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
