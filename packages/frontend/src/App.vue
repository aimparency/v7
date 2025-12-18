<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useUIStore } from './stores/ui'
import { useDataStore } from './stores/data'
import { trpc } from './trpc'
import RootAimsColumn from './components/RootAimsColumn.vue'
import PhaseColumn from './components/PhaseColumn.vue'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import AimCreationModal from './components/AimCreationModal.vue'
import AimSearchModal from './components/AimSearchModal.vue'
import GraphView from './views/GraphView.vue'
import WatchdogPanel from './components/WatchdogPanel.vue'
import ConsistencyModal from './components/ConsistencyModal.vue'
import ProjectSettingsModal from './components/ProjectSettingsModal.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()

// Local UI state
const showWatchdog = ref(localStorage.getItem('aimparency-show-watchdog') === 'true')
const watchdogHeight = ref(parseInt(localStorage.getItem('aimparency-watchdog-height') || '300'))
const showConsistencyModal = ref(false)
const isResizingWatchdog = ref(false)

// Persist watchdog visibility
watch(showWatchdog, (val) => {
  localStorage.setItem('aimparency-show-watchdog', String(val))
})

const startResizeWatchdog = (e: MouseEvent) => {
  e.preventDefault()
  isResizingWatchdog.value = true
  window.addEventListener('mousemove', resizeWatchdog)
  window.addEventListener('mouseup', stopResizeWatchdog)
}

const resizeWatchdog = (e: MouseEvent) => {
  if (!isResizingWatchdog.value) return
  const newHeight = window.innerHeight - e.clientY
  watchdogHeight.value = Math.max(100, Math.min(newHeight, window.innerHeight - 100))
}

const stopResizeWatchdog = () => {
  isResizingWatchdog.value = false
  localStorage.setItem('aimparency-watchdog-height', String(watchdogHeight.value))
  window.removeEventListener('mousemove', resizeWatchdog)
  window.removeEventListener('mouseup', stopResizeWatchdog)
}

// Template refs
const projectPathInput = ref('')

// Container offset based on viewport start from store
const containerOffset = computed(() => {
  const columnWidth = 100 / uiStore.viewportSize
  const columnsToShift = uiStore.viewportStart + 1
  const offset = columnsToShift * columnWidth
  return `translateX(-${offset}%)`
})

const columnWidth = computed(() => {
  return `${100 / uiStore.viewportSize}%`
})

const handleSelectProject = async () => {
  const path = projectPathInput.value.trim()
  await dataStore.loadProject(path)
  await trpc.project.buildSearchIndex.mutate({
    projectPath: path
  });
  await uiStore.selectPhase(0, 0)
  uiStore.ensureSelectionVisible()
}

const openProjectFromHistory = async (path: string) => {
  projectPathInput.value = path
  await dataStore.loadProject(path)
  await trpc.project.buildSearchIndex.mutate({
    projectPath: path
  });
  await uiStore.selectPhase(0, 0)
  uiStore.ensureSelectionVisible()
}

const removeFromHistory = (path: string, event: Event) => {
  event.stopPropagation()
  uiStore.removeProjectFromHistory(path)
}

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / (60 * 1000))
  const hours = Math.floor(diff / (60 * 60 * 1000))
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

const closeProject = () => {
  // Just clearing the project path will reset the app state
  uiStore.setProjectPath('')
}

// Global keydown handler
const handleGlobalKeydown = (event: KeyboardEvent) => {
  // Ignore if in project selection screen
  if (uiStore.isInProjectSelection) return

  // Ignore if user is typing in an input (except Escape which might be needed to close modals/search)
  const target = event.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  
  if (isInput) return

  // Watchdog toggle
  if (event.key === 'w' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    showWatchdog.value = !showWatchdog.value
    return
  }

  uiStore.handleGlobalKeydown(event, dataStore)
}

// Update keyboard hints based on navigation state and selected column
watch(() => [uiStore.navigatingAims, uiStore.selectedColumn], ([navigatingAims, selectedColumn]) => {
  if (!navigatingAims) {
    const hints = [
      { key: '/', action: 'search' },
      { key: 'h/l', action: 'switch columns' },
      { key: 'j/k', action: 'navigate phases/aims' },
      { key: 'i', action: 'enter edit mode' },
      { key: 'o', action: 'create phase/aim' }
    ]

    if (selectedColumn === 0) {
      // Root aims column
      hints.push({ key: 'd', action: 'delete aim' })
    } else {
      // Phase columns
      hints.push({ key: 'e', action: 'edit phase' })
    }

    uiStore.setKeyboardHints(hints)
  } else {
    uiStore.setKeyboardHints([
      { key: '/', action: 'search' },
      { key: 'j/k', action: 'navigate aims' },
      { key: 'h/l', action: 'collapse/expand' },
      { key: 'e', action: 'edit aim' },
      { key: 'd', action: 'delete aim' },
      { key: 'o/O', action: 'create aim below/above' },
      { key: 'Esc', action: 'exit edit mode' }
    ])
  }
}, { immediate: true })

// Watch for modal close
watch(() => [uiStore.showPhaseModal, uiStore.showAimModal], async () => {
  // When both modals are closed, we don't need to manually restore focus 
  // because we use window listener now.
})

// Persist selection state
watch(() => [
  uiStore.selectedColumn,
  uiStore.selectedPhaseByColumn,
  uiStore.selectedPhaseIdByColumn,
  uiStore.columnParentPhaseId,
  uiStore.floatingAimIndex,
  uiStore.viewportStart,
  uiStore.lastSelectedSubPhaseIndexByPhase
], () => {
  localStorage.setItem('aimparency-selected-column', uiStore.selectedColumn.toString())
  localStorage.setItem('aimparency-selected-phases', JSON.stringify(uiStore.selectedPhaseByColumn))
  localStorage.setItem('aimparency-selected-phase-ids', JSON.stringify(uiStore.selectedPhaseIdByColumn))
  localStorage.setItem('aimparency-column-parents', JSON.stringify(uiStore.columnParentPhaseId))
  localStorage.setItem('aimparency-floating-index', uiStore.floatingAimIndex.toString())
  localStorage.setItem('aimparency-viewport-start', uiStore.viewportStart.toString())
  localStorage.setItem('aimparency-last-sub-phase-index', JSON.stringify(uiStore.lastSelectedSubPhaseIndexByPhase))
}, { deep: true })

onMounted(async () => {
  // Register global keydown listener
  window.addEventListener('keydown', handleGlobalKeydown)

  if (uiStore.projectPath) {
    // Save restored column because selectPhase(0) resets it
    const restoredColumn = uiStore.selectedColumn
    const rootIndex = uiStore.selectedPhaseByColumn[0] ?? 0

    // Load all project data first
    await dataStore.loadProject(uiStore.projectPath);

    // Build search index
    await trpc.project.buildSearchIndex.mutate({
      projectPath: uiStore.projectPath
    });

    // Then, select the first root phase (index 0 in column 0) to kick off the cascade
    await uiStore.selectPhase(0, rootIndex);
    
    // Restore column focus
    uiStore.setSelectedColumn(restoredColumn);
    
    uiStore.ensureSelectionVisible();
  } else {
    // Set initial focus to the first phase column
    uiStore.setSelectedColumn(0);
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
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
        
        <div class="column-controls" v-if="uiStore.currentView === 'columns'">
          <button @click="uiStore.setViewportSize(uiStore.viewportSize - 1)" class="icon-btn" title="Decrease columns">-</button>
          <span>{{ uiStore.viewportSize }} columns</span>
          <button @click="uiStore.setViewportSize(uiStore.viewportSize + 1)" class="icon-btn" title="Increase columns">+</button>
        </div>

        <div class="view-controls">
          <button 
            @click="uiStore.setView('columns')" 
            :class="{ active: uiStore.currentView === 'columns' }"
            class="view-btn"
          >Columns</button>
          <button 
            @click="uiStore.setView('graph')" 
            :class="{ active: uiStore.currentView === 'graph' }"
            class="view-btn"
          >Graph</button>
        </div>

        <button 
          @click="showWatchdog = !showWatchdog" 
          class="icon-btn" 
          style="width: auto; padding: 0 0.5rem;"
          :style="{ background: showWatchdog ? '#444' : 'transparent' }"
          title="Toggle Watchdog Panel"
        >
          Watchdog
        </button>

        <div class="project-info">
          <span class="project-path">{{ uiStore.projectPath }}</span>

          <button @click="uiStore.openSettingsModal()" class="icon-btn" title="Project Settings" style="width: auto; padding: 0 0.5rem; font-size: 0.9rem;">
            ⚙️
          </button>

          <button 
            v-if="uiStore.projectPath"
            class="consistency-btn"
            :class="{ 'has-errors': dataStore.consistencyErrors.length > 0 }"
            @click="showConsistencyModal = true"
            :title="dataStore.consistencyErrors.length > 0 ? 'Data Inconsistencies Found' : 'Data is Consistent'"
          >
            {{ dataStore.consistencyErrors.length > 0 ? '×' : '✓' }}
          </button>
        </div>

        <a @click="closeProject" class="close-project">Close Project</a>
      </div>
    </header>

    <!-- Project Selection -->
    <div v-if="uiStore.isInProjectSelection" class="project-selection">
      <h1>Aimparency</h1>
      <p>Select a project base folder to get started</p>

      <div class="project-input-container">
        <input
          v-model="projectPathInput"
          type="text"
          placeholder="Enter project folder path..."
          class="project-input"
          @keydown.enter="handleSelectProject"
        />
        <button @click="handleSelectProject" class="select-project">Open Project</button>
      </div>

      <!-- Project History -->
      <div v-if="uiStore.projectHistory.length > 0" class="project-history">
        <h3>Recent Projects</h3>
        <div class="history-list">
          <div
            v-for="project in uiStore.projectHistory"
            :key="project.path"
            class="history-item"
            :class="{ failed: project.failedToLoad }"
            @click="openProjectFromHistory(project.path)"
          >
            <div class="history-item-content">
              <div class="history-path">{{ project.path }}</div>
              <div class="history-time">{{ formatRelativeTime(project.lastOpened) }}</div>
            </div>
            <button
              class="remove-button"
              @click="removeFromHistory(project.path, $event)"
              title="Remove from history"
            >×</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Interface -->
    <div v-else class="main-split">
      <main class="content-area">
        <!-- Columns View -->
        <div 
          v-if="uiStore.currentView === 'columns'"
          class="columns-layout" 
          :style="{ transform: containerOffset, '--column-width': columnWidth }"
        >
          <!-- Root Aims Column (Column -1) -->
          <RootAimsColumn
            class="column-aims"
          />

          <!-- Phase Columns (0, 1, 2...) -->
          <PhaseColumn
            v-for="colIndex in [...Array(uiStore.rightmostColumnIndex + 1).keys()]"
            :key="colIndex"
            :column-index="colIndex"
            :parent-phase-id="uiStore.columnParentPhaseId[colIndex] ?? null"
            class="column"
            :is-selected="uiStore.selectedColumn === colIndex"
            :is-active="uiStore.selectedColumn === colIndex"
            :selected-phase-index="uiStore.getSelectedPhase(colIndex)"
          />
        </div>

        <!-- Graph View -->
        <GraphView v-else-if="uiStore.currentView === 'graph'" />
      </main>

      <!-- Watchdog Panel -->
      <div v-if="showWatchdog" class="watchdog-container" :style="{ height: watchdogHeight + 'px' }">
        <div class="resize-handle" @mousedown="startResizeWatchdog"></div>
        <WatchdogPanel />
      </div>
    </div>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal />
    
    <!-- Aim Creation Modal -->
    <AimCreationModal v-if="uiStore.showAimModal" />

    <!-- Aim Search Modal -->
    <AimSearchModal v-if="uiStore.showAimSearch" />

    <!-- Consistency Modal -->
    <ConsistencyModal 
        v-if="showConsistencyModal" 
        @close="showConsistencyModal = false" 
    />

    <ProjectSettingsModal />

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

.column-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #888;
  font-size: 0.8rem;
}

.icon-btn {
  background: transparent;
  border: 1px solid #444;
  color: #e0e0e0;
  border-radius: 3px;
  width: 1.2rem;
  height: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
  
.icon-btn:hover {
  background: #444;
}

.project-info {
  display: flex;
  align-items: center;
  gap: 0.25rem; /* Reduced gap */
  white-space: nowrap; /* Prevent wrapping */
}

.project-path {
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

.consistency-btn {
  width: 20px; 
  height: 20px; 
  background: #007acc; 
  color: white; 
  border-radius: 0.15rem; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  font-weight: bold; 
  cursor: pointer; 
  border: none;
  font-size: 14px;
  /* Margins handled by parent flex gap */
}

.consistency-btn:hover {
  background: #005a99;
}

.consistency-btn.has-errors {
  background: #ff4444;
}

.consistency-btn.has-errors:hover {
  background: #ff6666;
}

.project-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  padding: 2rem;
  max-width: 50rem;
  width: 100%;
  margin: 0 auto;
}

.project-input-container {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.project-input {
  flex: 1;
  padding: 0.75rem 1rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  color: #e0e0e0;
  font-size: 1rem;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #666;
  }
}

.select-project {
  background: #007acc;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.3125rem;
  cursor: pointer;
  font-size: 1rem;
  white-space: nowrap;
}

.select-project:hover {
  background: #005a99;
}

.project-history {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;

  h3 {
    margin: 0;
    font-size: 1rem;
    color: #ccc;
  }
}

.history-list {
  max-height: 20rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 0.375rem;
  }

  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 0.1875rem;

    &:hover {
      background: #666;
    }
  }

  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: #2d2d2d;
  border: 1px solid #444;
  border-radius: 0.3125rem;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #333;
  }

  &.failed {
    .history-path {
      color: #ff6666;
    }
    border-color: #ff666644;
  }
}

.history-item-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
}

.history-path {
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  font-size: 0.8rem;
  color: #888;
  white-space: nowrap;
}

.remove-button {
  background: transparent;
  border: none;
  color: #888;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.5rem;
  line-height: 1;
  transition: color 0.2s;

  &:hover {
    color: #ff6666;
  }
}

.main-split {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.watchdog-container {
  flex-shrink: 0;
  border-top: 1px solid #444;
  position: relative;
  display: flex;
  flex-direction: column;
}

.resize-handle {
  position: absolute;
  top: -5px;
  left: 0;
  right: 0;
  height: 10px;
  cursor: ns-resize;
  z-index: 10;
  background: transparent;
}

.resize-handle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.columns-layout {
  flex: 1;
  display: flex;
  flex-direction: row;
  position: relative;
  transition: transform 0.3s ease;
  min-height: 0;
  width: 100%;
}

.column-aims,
.column {
  flex-basis: var(--column-width);
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid #444;
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

.view-controls {
  display: flex;
  gap: 0;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 3px;
  overflow: hidden;
}

.view-btn {
  background: transparent;
  border: none;
  color: #888;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  font-size: 0.8rem;
  
  &:hover {
    background: #333;
    color: #ccc;
  }
  
  &.active {
    background: #444;
    color: #fff;
  }
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
  border-radius: 0.1875rem;
  font-size: 0.8rem;
}

/* Global styles */
kbd {
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 0.1875rem;
  font-size: 0.8rem;
}
</style>