<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useWatchdogStore } from '../stores/watchdog'
import WatchdogTerminal from './WatchdogTerminal.vue'

const store = useWatchdogStore()
const workerTerm = ref<InstanceType<typeof WatchdogTerminal>>()
const watchdogTerm = ref<InstanceType<typeof WatchdogTerminal>>()

onMounted(() => {
  store.connect()
  
  // Watch for incoming data and write to terminals
  // Note: store buffers accumulate, but we only want *new* data if we stream it.
  // Actually, the store appends to a string. Watching the string for changes might be inefficient for large logs.
  // Ideally, the store would emit events or we'd hook directly into the socket handlers.
  // BUT, to keep store simple, let's watch the buffer length?
  // Or better: pass the raw data handling to the component?
  // The store already has listeners. We can modify the store to provide an event hook?
  // OR just assume we re-render or append.
  // The 'watch' approach on a string is bad for performance.
  
  // Let's hook into the socket events directly in this component?
  // Or make the store expose an event emitter?
  // Or just polling?
  
  // Let's modify the store to expose a "lastChunk" ref that updates?
  // Actually, let's stick to the store having the socket, and we listen to the socket in the component?
  // But we want the store to manage connection state.
  // Let's use the store's socket reference.
});

// Watch for socket availability to hook up listeners for TERMINAL streaming (bypassing the store string buffer for display)
watch(() => store.socket, (socket) => {
  if (socket) {
    socket.on('worker-data', (data: string) => {
      workerTerm.value?.write(data)
    })
    socket.on('watchdog-data', (data: string) => {
      watchdogTerm.value?.write(data)
    })
  }
})

const handleWorkerInput = (data: string) => {
  store.sendWorkerInput(data)
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
          :onData="handleWorkerInput"
          @resize="(dims) => store.socket?.emit('resize-worker', dims)"
        />
      </div>
      <div class="term-col">
        <div class="term-label">Watchdog (Brain)</div>
        <WatchdogTerminal 
          ref="watchdogTerm" 
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
