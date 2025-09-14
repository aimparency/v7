<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import type { Phase, Hint } from 'shared'
import { useUIStore } from './stores/ui'
import { useDataStore } from './stores/data'
import { trpc } from './trpc'
import RootAimsColumn from './components/RootAimsColumn.vue'
import PhaseColumn from './components/PhaseColumn.vue'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import AimCreationModal from './components/AimCreationModal.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()

// Template refs
const rootAimsColumnRef = ref<InstanceType<typeof RootAimsColumn> | null>(null)
const firstPhaseColumnRef = ref<InstanceType<typeof PhaseColumn> | null>(null)

// Root phases for the first phase column
const rootPhases = ref<Phase[]>([])

const selectProject = async () => {
  const path = prompt('Enter project base folder path:')
  if (path) {
    uiStore.setProjectPath(path)
    uiStore.setConnectionStatus('connecting')
    // Load root phases for first phase column
    await loadRootPhases(path)
    uiStore.setConnectionStatus('connected')
  }
}

const loadRootPhases = async (projectPath: string) => {
  try {
    const phases = await trpc.phase.list.query({
      projectPath,
      parentPhaseId: null
    })
    rootPhases.value = phases
  } catch (error) {
    console.error('Failed to load root phases:', error)
    rootPhases.value = []
  }
}

const closeProject = () => {
  uiStore.setProjectPath('')
}

// Handle navigation from root aims column to first phase column
const handleNavigateFromAims = async () => {
  if (uiStore.canNavigateRight) {
    uiStore.setFocusedColumn(1)
    await nextTick()
    firstPhaseColumnRef.value?.focusSelectedPhase()
  }
}

// Handle navigation from first phase column back to aims
const handleNavigateToAims = async () => {
  if (uiStore.canNavigateLeft) {
    uiStore.setFocusedColumn(0)
    await nextTick()
    rootAimsColumnRef.value?.focusSelectedAim()
  }
}

// Handle navigation from any column
const handleNavigateLeft = async () => {
  if (uiStore.canNavigateLeft) {
    const newIndex = uiStore.focusedColumnIndex - 1
    uiStore.setFocusedColumn(newIndex)
    await nextTick()

    if (newIndex === 0) {
      rootAimsColumnRef.value?.focusSelectedAim()
    } else if (newIndex === 1) {
      firstPhaseColumnRef.value?.focusSelectedPhase()
    }
    // For teleported columns, they handle their own focus
  }
}

const handleNavigateRight = async () => {
  if (uiStore.canNavigateRight) {
    const newIndex = uiStore.focusedColumnIndex + 1
    uiStore.setFocusedColumn(newIndex)
    await nextTick()

    if (newIndex === 1) {
      firstPhaseColumnRef.value?.focusSelectedPhase()
    }
    // For teleported columns, they handle their own focus
  }
}

// Set global unfocused hints
const setGlobalHints = () => {
  uiStore.setKeyboardHints([
    { key: 'h/l', action: 'navigate columns' },
    { key: 'j/k/i', action: 'focus current column' }
  ])
}

// Global keyboard handler for unfocused state
const handleGlobalKeydown = (event: KeyboardEvent) => {
  // Only handle if no element is focused (or body is focused)
  const activeElement = document.activeElement
  if (activeElement && activeElement !== document.body && activeElement.tagName !== 'BODY') {
    return
  }

  // Set global hints if not already set
  if (uiStore.keyboardHints.length === 0) {
    setGlobalHints()
  }

  switch (event.key) {
    case 'h':
      event.preventDefault()
      handleNavigateLeft()
      break
    case 'l':
      event.preventDefault()
      handleNavigateRight()
      break
    case 'j':
    case 'k':
    case 'i':
      event.preventDefault()
      // Focus current column based on focused index
      const focusedIndex = uiStore.focusedColumnIndex
      if (focusedIndex === 0) {
        rootAimsColumnRef.value?.focusSelectedAim()
      } else if (focusedIndex === 1) {
        firstPhaseColumnRef.value?.focusSelectedPhase()
      }
      // For teleported columns, they handle their own focus
      break
  }
}

onMounted(async () => {
  uiStore.setFocusedColumn(0) // Start focused on aims

  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await loadRootPhases(uiStore.projectPath)
    uiStore.setConnectionStatus('connected')
  }

  // Set initial global hints
  setGlobalHints()

  // Add global keyboard listener
  document.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  // Remove global keyboard listener
  document.removeEventListener('keydown', handleGlobalKeydown)
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
      <!-- Root Aims Column (Column 0) -->
      <RootAimsColumn
        ref="rootAimsColumnRef"
        class="column-0"
        @request-navigate-right="handleNavigateRight"
        @focus="uiStore.setFocusedColumn(0)"
      />

      <!-- First Phase Column (Column 1) -->
      <PhaseColumn
        ref="firstPhaseColumnRef"
        :phases="rootPhases"
        :column-index="1"
        :column-depth="1"
        class="column-1"
        @request-navigate-left="handleNavigateLeft"
        @focus="uiStore.setFocusedColumn(1)"
      />
    </main>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal />
    
    <!-- Aim Creation Modal -->
    <AimCreationModal />

    <!-- Help Text -->
    <footer v-if="!uiStore.isInProjectSelection" class="help">
      <div class="help-keys">
        <div v-for="hint in uiStore.keyboardHints" :key="`${hint.key}-${hint.action}`" class="hint">
          <span class="key">{{ hint.key }}</span>
          <span class="action">{{ hint.action }}</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  color: #e0e0e0;
  font-family: 'Monaco', 'Menlo', monospace;
}

.header {
  background: #2d2d2d;
  padding: 0.25rem 1rem;
  border-bottom: 1px solid #444;
  font-size: 0.8rem;
}

.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.connection-status {
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
  position: relative;
}

/* Base column positioning */
.column-0 {
  position: absolute;
  left: 0;
  top: 0;
  width: 50%;
  height: 100%;
  z-index: 1;
}

.column-1 {
  position: absolute;
  left: 50%;
  top: 0;
  width: 50%;
  height: 100%;
  z-index: 1;
}


.help {
  background: #2d2d2d;
  padding: 0.25rem 1rem;
  border-top: 1px solid #444;
  font-size: 0.8rem;
}

.help-keys {
  display: block;
  color: #888;
}

.hint {
  display: inline-block;
  margin-right: 2rem;
  margin-bottom: 0.25rem;
}

.key {
  color: #fff;
  font-weight: bold;
  margin-right: 0.5rem;
}

.action {
  color: #888;
}

kbd {
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-family: monospace;
}

/* Global styles */
kbd {
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-family: monospace;
}
</style>