<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useUIStore, type AimPath } from './stores/ui'
import { useDataStore, type Aim } from './stores/data'
import { trpc } from './trpc'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import AimCreationModal from './components/AimCreationModal.vue'
import AimSearchModal from './components/AimSearchModal.vue'
import ColumnsView from './views/ColumnsView.vue'
import GraphViewWrapper from './views/GraphViewWrapper.vue'
import ProjectSelectionView from './views/ProjectSelectionView.vue'
import VoiceView from './views/VoiceView.vue'
import WatchdogPanel from './components/WatchdogPanel.vue'
import ConsistencyModal from './components/ConsistencyModal.vue'
import ProjectSettingsModal from './components/ProjectSettingsModal.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()

const handleAimSearchSelect = (payload: { type: 'aim' | 'path', data: Aim | AimPath }) => {
  if (uiStore.aimSearchMode === 'pick') {
    if (uiStore.aimSearchCallback && payload.type === 'aim') {
      uiStore.aimSearchCallback(payload.data as Aim)
    }
  } else {
    // Navigate
    if (payload.type === 'path') {
      uiStore.executeNavigation(payload.data as AimPath)
    }
  }
  uiStore.closeAimSearch()
}

// Local UI state
const watchdogHeight = ref(parseInt(localStorage.getItem('aimparency-watchdog-height') || '300'))
const watchdogRef = ref<InstanceType<typeof WatchdogPanel>>()
const showConsistencyModal = ref(false)
const isResizingWatchdog = ref(false)

// Persist watchdog visibility and handle focus
watch(() => uiStore.showWatchdog, (val) => {
  localStorage.setItem('aimparency-show-watchdog', String(val))
  if (val) {
    nextTick(() => {
      watchdogRef.value?.focusWorker()
    })
  }
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

const removeFromHistory = (path: string) => {
  uiStore.removeProjectFromHistory(path)
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
    uiStore.showWatchdog = !uiStore.showWatchdog
    return
  }

  // Voice view toggle
  if (event.key === 'v' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    uiStore.setView(uiStore.currentView === 'voice' ? 'columns' : 'voice')
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
      { key: 'o', action: 'create phase/aim' },
      { key: 'v', action: 'voice mode' }
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
          <button 
            @click="uiStore.setView('voice')" 
            :class="{ active: uiStore.currentView === 'voice' }"
            class="view-btn"
          >Voice</button>
        </div>

        <button 
          @click="uiStore.showWatchdog = !uiStore.showWatchdog" 
          class="icon-btn" 
          style="width: auto; padding: 0 0.5rem;"
          :style="{ background: uiStore.showWatchdog ? '#444' : 'transparent' }"
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

          <button 
            v-if="uiStore.projectPath"
            class="icon-btn"
            title="Refresh Consistency Check"
            @click="dataStore.checkConsistency(uiStore.projectPath)"
            style="font-size: 0.7rem; margin-left: 2px"
          >
            🔄
          </button>
        </div>

        <a @click="closeProject" class="close-project">Close Project</a>
      </div>
    </header>

    <ProjectSelectionView
      v-if="uiStore.isInProjectSelection"
      v-model="projectPathInput"
      :project-history="uiStore.projectHistory"
      @select-project="handleSelectProject"
      @open-project-from-history="openProjectFromHistory"
      @remove-from-history="removeFromHistory"
    />

    <!-- Main Interface -->
    <div v-else class="main-split">
      <main class="content-area" v-show="!(uiStore.showWatchdog && uiStore.watchdogMaximized)">
        <!-- Columns View -->
        <ColumnsView v-if="uiStore.currentView === 'columns'" />

        <!-- Graph View -->
        <GraphViewWrapper v-else-if="uiStore.currentView === 'graph'" />

        <!-- Voice View -->
        <VoiceView v-else-if="uiStore.currentView === 'voice'" />
      </main>

      <!-- Watchdog Panel -->
      <div 
        v-if="uiStore.showWatchdog" 
        class="watchdog-container" 
        :style="{ height: uiStore.watchdogMaximized ? '100%' : watchdogHeight + 'px' }"
      >
        <div class="resize-handle" v-if="!uiStore.watchdogMaximized" @mousedown="startResizeWatchdog"></div>
        <WatchdogPanel ref="watchdogRef" />
      </div>
    </div>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal />
    
    <!-- Aim Creation Modal -->
    <AimCreationModal v-if="uiStore.showAimModal" />

    <!-- Aim Search Modal -->
    <AimSearchModal 
      v-if="uiStore.showAimSearch" 
      @select="handleAimSearchSelect"
      @close="uiStore.closeAimSearch()"
    />

    <!-- Consistency Modal -->
    <ConsistencyModal 
        v-if="showConsistencyModal" 
        @close="showConsistencyModal = false" 
    />

    <ProjectSettingsModal v-if="uiStore.showSettingsModal" />

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
