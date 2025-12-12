<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { io } from 'socket.io-client';
import Terminal from './components/Terminal.vue';

const socket = io();
const status = ref('stopped'); // stopped implies Logic Disabled, but agents running
const emergencyStopped = ref(false);
const stopReason = ref('');

onMounted(() => {
  socket.on('watchdog-state', (enabled: boolean) => {
    status.value = enabled ? 'running' : 'stopped';
    if (enabled) {
      stopReason.value = '';
      emergencyStopped.value = false;
    }
  });
  socket.on('watchdog-stop-reason', (reason: string) => {
    stopReason.value = reason;
  });
  socket.on('emergency-state', (stopped: boolean) => {
    if (stopped && !stopReason.value) stopReason.value = 'Emergency Stop';
  });
  socket.on('emergency-stop', () => {
    status.value = 'stopped';
    stopReason.value = 'Emergency Stop';
  });
  socket.on('status', (s: string) => status.value = s === 'running' ? 'running' : 'stopped');
});

function toggleWatchdog() {
  // Logic toggle
  const newState = status.value !== 'running'; // Toggle
  socket.emit('toggle-watchdog', newState);
}
</script>

<template>
  <div class="layout">
    <div class="worker-pane">
      <div class="header">Worker</div>
      <Terminal 
        :socket="socket" 
        channelIn="worker-data" 
        channelOut="worker-input" 
        resizeEvent="resize-worker"
      />
    </div>
    <div class="watchdog-pane">
      <div class="header">
        Watchdog
        <span v-if="status === 'stopped' && stopReason" style="color: #fa0; font-weight: bold; margin: 0 10px;">stopped: {{ stopReason }}</span>
        <button @click="toggleWatchdog" :class="{ running: status === 'running' }">
          {{ status === 'running' ? 'Disable Watchdog' : 'Enable Watchdog' }}
        </button>
      </div>
      <Terminal 
        :socket="socket" 
        channelIn="watchdog-data" 
        channelOut="watchdog-input"
        resizeEvent="resize-watchdog"
      />
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; width: 100%; background: #000; color: white; overflow: hidden; }
.layout { display: flex; flex-direction: column; height: 100vh; width: 100%; }

.worker-pane { flex: 3; display: flex; flex-direction: column; border-bottom: 1px solid #333; min-height: 0; position: relative; }
.watchdog-pane { flex: 2; display: flex; flex-direction: column; min-height: 0; position: relative; }

.header { 
  background: #333; 
  padding: 5px 10px; 
  font-family: monospace; 
  font-weight: bold; 
  font-size: 12px; 
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

button {
  background: #28a745;
  color: white;
  border: none;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: monospace;
  font-weight: bold;
  border-radius: 3px;
}

button.running {
  background: #dc3545;
}
</style>
