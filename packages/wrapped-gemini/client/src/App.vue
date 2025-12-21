<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { io, type Socket } from 'socket.io-client';
import Terminal from './components/Terminal.vue';
import { trpc } from './trpc';

const socket = ref<Socket | null>(null);
const status = ref('stopped');
const emergencyStopped = ref(false);
const stopReason = ref('');

interface Session {
    projectPath: string;
    pid: number;
    port: number;
    lastKeepalive: number;
}
const sessions = ref<Session[]>([]);
const currentSession = ref<Session | null>(null);
const newProjectPath = ref('');
const loading = ref(false);

async function refreshSessions() {
    try {
        sessions.value = await trpc.watchdog.list.query();
    } catch (e) {
        console.error("Failed to list sessions", e);
    }
}

async function connectToSession(session: Session) {
    loading.value = true;
    try {
        // Ensure it's alive/started via backend just in case
        await trpc.watchdog.start.mutate({ projectPath: session.projectPath });
        
        currentSession.value = session;
        const url = `http://localhost:${session.port}`;
        console.log(`Connecting to ${url}`);
        
        socket.value = io(url);
        setupSocket(socket.value);
    } catch (e) {
        console.error("Failed to connect", e);
        alert("Failed to connect: " + e);
    } finally {
        loading.value = false;
    }
}

async function createSession() {
    if (!newProjectPath.value) return;
    loading.value = true;
    try {
        const res = await trpc.watchdog.start.mutate({ projectPath: newProjectPath.value });
        // Refresh list and connect
        await refreshSessions();
        const session = sessions.value.find(s => s.projectPath === newProjectPath.value);
        if (session) {
            connectToSession(session);
        } else {
            // If list is stale or path normalization changed it, try constructing it manually or alerting
             connectToSession({ 
                 projectPath: newProjectPath.value, 
                 port: res.port, 
                 pid: res.pid, 
                 lastKeepalive: Date.now() 
             });
        }
    } catch (e) {
        console.error("Failed to create session", e);
        alert("Error creating session: " + e);
    } finally {
        loading.value = false;
    }
}

function disconnect() {
    if (socket.value) {
        socket.value.disconnect();
        socket.value = null;
    }
    currentSession.value = null;
    status.value = 'stopped';
    refreshSessions();
}

function setupSocket(s: Socket) {
  s.on('watchdog-state', (enabled: boolean) => {
    status.value = enabled ? 'running' : 'stopped';
    if (enabled) {
      stopReason.value = '';
      emergencyStopped.value = false;
    }
  });
  s.on('watchdog-stop-reason', (reason: string) => {
    stopReason.value = reason;
  });
  s.on('emergency-state', (stopped: boolean) => {
    emergencyStopped.value = stopped;
    if (stopped && !stopReason.value) stopReason.value = 'Emergency Stop';
  });
  s.on('emergency-stop', () => {
    status.value = 'stopped';
    emergencyStopped.value = true;
    stopReason.value = 'Emergency Stop';
  });
  s.on('status', (s: string) => status.value = s === 'running' ? 'running' : 'stopped');
}

function toggleWatchdog() {
  if (!socket.value) return;
  const newState = status.value !== 'running';
  socket.value.emit('toggle-watchdog', newState);
}

onMounted(() => {
    refreshSessions();
});
</script>

<template>
  <div class="layout">
    <!-- Session Manager View -->
    <div v-if="!currentSession" class="session-manager">
        <h1>Infinite Worker Manager</h1>
        <div class="controls">
            <input v-model="newProjectPath" placeholder="/path/to/project/.bowman" @keyup.enter="createSession" />
            <button @click="createSession" :disabled="loading || !newProjectPath">Start New</button>
            <button @click="refreshSessions" :disabled="loading">Refresh</button>
        </div>
        <div class="session-list">
            <div v-for="s in sessions" :key="s.projectPath" class="session-item" @click="connectToSession(s)">
                <div class="session-info">
                    <span class="path">{{ s.projectPath }}</span>
                    <span class="meta">PID: {{ s.pid }} | Port: {{ s.port }}</span>
                </div>
                <div class="arrow">→</div>
            </div>
            <div v-if="sessions.length === 0" class="empty">No active sessions.</div>
        </div>
    </div>

    <!-- Active Session View -->
    <template v-else>
        <div class="top-bar">
            <span>Session: {{ currentSession.projectPath }} ({{ currentSession.port }})</span>
            <button @click="disconnect" class="disconnect-btn">Disconnect</button>
        </div>
        <div class="worker-pane">
        <div class="header">Worker</div>
        <Terminal 
            v-if="socket"
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
            v-if="socket"
            :socket="socket" 
            channelIn="watchdog-data" 
            channelOut="watchdog-input"
            resizeEvent="resize-watchdog"
        />
        </div>
    </template>
  </div>
</template>

<style>
* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; width: 100%; background: #000; color: white; overflow: hidden; font-family: sans-serif; }
.layout { display: flex; flex-direction: column; height: 100vh; width: 100%; }

/* Session Manager */
.session-manager { padding: 2rem; max-width: 800px; margin: 0 auto; width: 100%; }
.session-manager h1 { margin-bottom: 2rem; color: #007acc; }
.controls { display: flex; gap: 10px; margin-bottom: 2rem; }
.controls input { flex: 1; padding: 10px; background: #222; border: 1px solid #444; color: white; border-radius: 4px; }
.controls button { padding: 10px 20px; font-size: 14px; }

.session-list { display: flex; flex-direction: column; gap: 10px; }
.session-item { background: #1a1a1a; padding: 15px; border-radius: 5px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333; transition: background 0.2s; }
.session-item:hover { background: #2a2a2a; border-color: #555; }
.session-info { display: flex; flex-direction: column; gap: 5px; }
.session-info .path { font-weight: bold; color: #e0e0e0; }
.session-info .meta { font-size: 0.8rem; color: #888; }
.arrow { font-size: 1.5rem; color: #555; }
.empty { color: #666; font-style: italic; }

/* Active Session */
.top-bar { background: #111; padding: 5px 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #888; }
.disconnect-btn { background: #333; color: #ccc; font-size: 10px; padding: 2px 6px; }

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

button:disabled { opacity: 0.5; cursor: not-allowed; }
button.running { background: #dc3545; }
</style>
