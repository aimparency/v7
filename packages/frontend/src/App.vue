<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import type { Phase, Hint } from 'shared'
import { useUIStore } from './stores/ui'
import { useDataStore } from './stores/data'
import PhaseColumn from './components/PhaseColumn.vue'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import AimCreationModal from './components/AimCreationModal.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()

// Template refs for dynamic columns
const columnRefs = ref<InstanceType<typeof PhaseColumn>[]>([])

// Track currently focused column index
const focusedColumnIndex = ref(0)

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

// Handle phase selection in any column to load next column
const handlePhaseSelected = async (columnIndex: number, phaseIndex: number, phase: Phase) => {
  // Update selection in data store
  dataStore.setSelectedPhaseIndex(columnIndex, phaseIndex)
  
  // Load next column with children of selected phase
  if (phase) {
    await dataStore.loadColumn(uiStore.projectPath, columnIndex + 1, phase.id)
  }
}

// Handle cross-column navigation
const handleRequestNavigateLeft = async () => {
  if (focusedColumnIndex.value > 0) {
    focusedColumnIndex.value--
    adjustViewport()
    await nextTick()
    focusColumn(focusedColumnIndex.value)
  }
}

const handleRequestNavigateRight = async () => {
  console.log('Before navigate right:', {
    focusedColumnIndex: focusedColumnIndex.value,
    viewportStart: dataStore.currentViewportStart,
    columnsLength: dataStore.phaseColumns.length
  })
  
  focusedColumnIndex.value++
  adjustViewport()
  
  console.log('After navigate right:', {
    focusedColumnIndex: focusedColumnIndex.value,
    viewportStart: dataStore.currentViewportStart
  })
  
  await nextTick()
  focusColumn(focusedColumnIndex.value)
}

const adjustViewport = () => {
  const focused = focusedColumnIndex.value
  const start = dataStore.currentViewportStart
  const end = start + dataStore.visibleColumnCount - 1
  
  console.log('adjustViewport:', { focused, start, end, visibleCount: dataStore.visibleColumnCount })
  
  if (focused < start) {
    console.log('Sliding left to show column', focused)
    dataStore.currentViewportStart = focused
  } else if (focused > end) {
    console.log('Sliding right to show column', focused)
    dataStore.currentViewportStart = focused - dataStore.visibleColumnCount + 1
  } else {
    console.log('Column already visible, no sliding needed')
  }
}

// Focus specific column
const focusColumn = (columnIndex: number) => {
  const column = columnRefs.value[columnIndex]
  column?.focusSelectedPhase()
}

// Set global unfocused hints
const setGlobalHints = () => {
  uiStore.setKeyboardHints([
    { key: 'h/l', action: 'focus columns' },
    { key: 'j/k/i', action: 'focus last column' }
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
      handleRequestNavigateLeft()
      break
    case 'l':
      event.preventDefault()
      handleRequestNavigateRight()
      break
    case 'j':
    case 'k':
    case 'i':
      event.preventDefault()
      // Focus current column
      focusColumn(focusedColumnIndex.value)
      break
  }
}

onMounted(async () => {
  // Set default column count (flexible for future)
  dataStore.setVisibleColumnCount(2)
  
  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await dataStore.loadPhases(uiStore.projectPath)
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

// Computed properties for rendering
const columnWidth = computed(() => {
  return `${100 / dataStore.visibleColumnCount}%`
})

const containerOffset = computed(() => {
  return `translateX(-${dataStore.currentViewportStart * (100 / dataStore.visibleColumnCount)}%)`
})

// Check if column should be visible (within viewport + buffer)
const isColumnVisible = (columnIndex: number) => {
  const start = dataStore.currentViewportStart
  const end = start + dataStore.visibleColumnCount
  // Show columns within viewport plus 1 buffer on each side
  return columnIndex >= start - 1 && columnIndex <= end
}
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
      <div class="phase-columns-container" :style="{ transform: containerOffset }">
        <!-- All Columns (one per tree level, show/hide based on viewport) -->
        <PhaseColumn
          v-for="(column, index) in dataStore.phaseColumns"
          :key="index"
          v-show="isColumnVisible(index)"
          :ref="(el) => { if (el) columnRefs[index] = el as InstanceType<typeof PhaseColumn> }"
          :phases="column"
          :column-index="index"
          :is-empty="column.length === 0"
          :style="{ width: columnWidth, height: '100%', position: 'absolute', left: `${index * (100 / dataStore.visibleColumnCount)}%` }"
          @phase-selected="handlePhaseSelected(index, $event.phaseIndex, $event.phase)"
          @request-navigate-left="handleRequestNavigateLeft"
          @request-navigate-right="handleRequestNavigateRight"
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
}

.phase-columns-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
  transition: transform 0.3s ease;
  width: 100%;
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