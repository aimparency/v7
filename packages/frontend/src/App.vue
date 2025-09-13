<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useUIStore } from './stores/ui'
import { useDataStore } from './stores/data'
import { useKeyboardStore } from './stores/keyboard'
import PhaseColumn from './components/PhaseColumn.vue'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import AimCreationModal from './components/AimCreationModal.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()
const keyboardStore = useKeyboardStore()

// Initialize UI state from store
if (uiStore.projectPath) {
  uiStore.setMode('column-navigation')
} else {
  uiStore.setMode('project-selection')
}

const selectProject = async () => {
  const path = prompt('Enter project base folder path:')
  if (path) {
    uiStore.setProjectPath(path)
    uiStore.setConnectionStatus('connecting')
    await dataStore.loadPhases(path)
    uiStore.setConnectionStatus('connected')
  }
}

const closeProject = () => {
  uiStore.setProjectPath('')
}

// Keyboard navigation using store
const handleKeydown = async (event: KeyboardEvent) => {
  if (uiStore.isInProjectSelection) return
  
  // Prevent default behavior for navigation keys
  if (['h', 'j', 'k', 'l', 'i', 'o', 'O', 'Escape'].includes(event.key)) {
    event.preventDefault()
  }
  
  await keyboardStore.handleKeydown(event)
}


onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await dataStore.loadPhases(uiStore.projectPath)
    uiStore.setConnectionStatus('connected')
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header v-if="!uiStore.isInProjectSelection" class="header">
      <div class="status">
        <span class="connection-status" :class="uiStore.connectionStatus">
          {{ uiStore.connectionStatus === 'connected' ? 'Connected to' : uiStore.connectionStatus }}
          {{ uiStore.connectionStatus === 'connected' ? 'aimparency server' : '' }}
        </span>
        <span class="project-path">{{ uiStore.projectPath }}</span>
        <a @click="closeProject" class="close-project">Close Project</a>
      </div>
    </header>

    <!-- Project Selection -->
    <div v-if="uiStore.isInProjectSelection" class="project-selection">
      <h1>Aimparency</h1>
      <p>Select a project base folder to get started</p>
      <button @click="selectProject" class="select-project">Select Project Folder</button>
    </div>

    <!-- Main Interface -->
    <main v-else class="main">
      <div class="phase-columns">
        <!-- Left Column -->
        <PhaseColumn
          :phases="dataStore.leftColumnPhases"
          column-type="left"
        />

        <!-- Right Column -->
        <PhaseColumn
          :phases="dataStore.rightColumnPhases"
          column-type="right"
          :is-empty="dataStore.rightColumnPhases.length === 0"
        />
      </div>
    </main>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal />
    
    <!-- Aim Creation Modal -->
    <AimCreationModal />

    <!-- Help Text -->
    <footer v-if="!uiStore.isInProjectSelection" class="help">
      <div class="help-keys">
        <span v-for="help in keyboardStore.keyHelp" :key="help.description">
          <kbd v-for="key in help.keys" :key="key">{{ key }}</kbd>
          {{ help.description }}
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #e0e0e0;
  font-family: 'Monaco', 'Menlo', monospace;
}

.header {
  background: #2d2d2d;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #444;
}

.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.connection-status {
  font-size: 0.8rem;
  opacity: 0.5;
}

.connection-status.connecting {
  color: #ffa566;
}

.connection-status.connected {
  color: #88ff88;
}

.connection-status.no-connection {
  color: #ff6666;
}

.project-path {
  font-family: monospace;
  color: #888;
}

.close-project {
  color: #888;
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.9rem;
}

.close-project:hover {
  color: #ccc;
}

.project-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
}

.select-project {
  background: #007acc;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 5px;
  cursor: pointer;
  font-size: 1.1rem;
}

.select-project:hover {
  background: #005a99;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.phase-columns {
  display: flex;
  flex: 1;
  overflow: hidden;
}


.help {
  background: #2d2d2d;
  padding: 0.5rem 1rem;
  border-top: 1px solid #444;
}

.help-keys {
  display: flex;
  gap: 2rem;
  font-size: 0.9rem;
  color: #888;
}

.help-keys span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

kbd {
  background: #444;
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-family: monospace;
}

/* Global styles */
kbd {
  background: #444;
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-family: monospace;
}
</style>