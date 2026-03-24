<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useUIStore, type AimPath } from './stores/ui'
import { useUIModalStore } from './stores/ui/modal-store'
import { useGraphUIStore } from './stores/ui/graph-store'
import { useProjectStore } from './stores/project-store'
import { useDataStore, type Aim } from './stores/data'
import { useMapStore } from './stores/map'
import { trpc } from './trpc'
import type { AimSearchAdditionalOption, AimSearchPickPayload } from './stores/ui/aim-search-types'
import type { PhaseSearchSelection } from './stores/ui/phase-search-types'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import AimCreationModal from './components/AimCreationModal.vue'
import AimEditModal from './components/AimEditModal.vue'
import AimSearchModal from './components/AimSearchModal.vue'
import PhaseSearchModal from './components/PhaseSearchModal.vue'
import ColumnsView from './views/ColumnsView.vue'
import GraphViewWrapper from './views/GraphViewWrapper.vue'
import ProjectSelectionView from './views/ProjectSelectionView.vue'
import VoiceView from './views/VoiceView.vue'
import WatchdogPanel from './components/WatchdogPanel.vue'
import ConsistencyModal from './components/ConsistencyModal.vue'
import ProjectSettingsModal from './components/ProjectSettingsModal.vue'
import { getRuntimeConfig } from './utils/runtime-config'

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const graphUIStore = useGraphUIStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()
const mapStore = useMapStore()
const voiceEnabled = getRuntimeConfig().voiceEnabled

const normalizedProjectRoot = computed(() => projectStore.projectPath.replace(/\/+$/, ''))
const activeBowmanRoot = computed(() => normalizedProjectRoot.value ? `${normalizedProjectRoot.value}/.bowman` : '')
const activeProjectName = computed(() => {
  const projectRoot = normalizedProjectRoot.value
  if (!projectRoot) return ''

  const segments = projectRoot.split('/').filter(Boolean)
  return segments.at(-1) || projectRoot
})

const handleAimSearchSelect = (payload: { type: 'aim' | 'path', data: Aim | AimPath } | { type: 'option', data: AimSearchAdditionalOption }) => {
  if (modalStore.aimSearchMode === 'pick') {
    if (modalStore.aimSearchCallback && payload.type !== 'path') {
      modalStore.aimSearchCallback(payload as AimSearchPickPayload)
    }
  } else {
    if (projectStore.currentView === 'graph' && payload.type === 'aim') {
      const aim = payload.data as Aim
      const node = mapStore.getNode(aim.id)
      graphUIStore.setGraphSelection(aim.id)
      graphUIStore.deselectLink()
      if (node) {
        mapStore.centerOnNode(node)
      }
    } else if (payload.type === 'path') {
      uiStore.executeNavigation(payload.data as AimPath)
    }
  }
  modalStore.closeAimSearch()
}

const handlePhaseSearchSelect = (payload: PhaseSearchSelection) => {
  if (modalStore.phaseSearchPromptCallback) {
    modalStore.phaseSearchPromptCallback(payload)
  }
  modalStore.closePhaseSearchPrompt()
}

// Local UI state
const watchdogHeight = ref(parseInt(localStorage.getItem('aimparency-watchdog-height') || '300'))
const watchdogRef = ref<InstanceType<typeof WatchdogPanel>>()
const showConsistencyModal = ref(false)
const isResizingWatchdog = ref(false)
const discoveredProjects = ref<Array<{ path: string, bowmanPath: string, sourceRoot: string }>>([])
const discoveredProjectRoots = ref<string[]>([])
const isRefreshingDiscoveredProjects = ref(false)

// Persist watchdog visibility and handle focus
watch(() => projectStore.showWatchdog, (val) => {
  localStorage.setItem('aimparency-show-watchdog', String(val))
  if (val) {
    nextTick(() => {
      watchdogRef.value?.focusWorker()
    })
  }
})

watch(() => projectStore.isInProjectSelection, (isInProjectSelection) => {
  if (isInProjectSelection) {
    void refreshDiscoveredProjects()
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

const refreshDiscoveredProjects = async () => {
  if (!projectStore.isInProjectSelection) return

  isRefreshingDiscoveredProjects.value = true
  try {
    const result = await trpc.project.discoverLocalProjects.query()
    discoveredProjects.value = result.projects
    discoveredProjectRoots.value = result.rootsScanned
  } catch (error) {
    console.error('Failed to discover local projects', error)
    discoveredProjects.value = []
    discoveredProjectRoots.value = []
  } finally {
    isRefreshingDiscoveredProjects.value = false
  }
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

const openDiscoveredProject = async (path: string) => {
  projectPathInput.value = path
  await handleSelectProject()
}

const removeFromHistory = (path: string) => {
  projectStore.removeProjectFromHistory(path)
}

const closeProject = () => {
  // Just clearing the project path will reset the app state
  projectStore.setProjectPath('')
}

// Global keydown handler
const handleGlobalKeydown = (event: KeyboardEvent) => {
  // Ignore if in project selection screen
  if (projectStore.isInProjectSelection) return

  // Ignore if user is typing in an input (except Escape which might be needed to close modals/search)
  const target = event.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  
  if (isInput) return

  // Watchdog toggle
  if (event.key === 'w' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    projectStore.showWatchdog = !projectStore.showWatchdog
    return
  }

  // Voice view toggle
  if (voiceEnabled && event.key === 'v' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    uiStore.setView(projectStore.currentView === 'voice' ? 'columns' : 'voice')
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

    if (voiceEnabled) {
      hints.push({ key: 'v', action: 'voice mode' })
    }

    if (selectedColumn === 0) {
      // Root aims column
      hints.push({ key: 'd', action: 'delete aim' })
    } else {
      // Phase columns
      hints.push({ key: 'e', action: 'edit phase' })
    }

    projectStore.setKeyboardHints(hints)
  } else {
    projectStore.setKeyboardHints([
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

watch(() => projectStore.currentView, (currentView) => {
  if (!voiceEnabled && currentView === 'voice') {
    uiStore.setView('columns')
  }
}, { immediate: true })

// Watch for modal close
watch(() => [modalStore.showPhaseModal, modalStore.showAimModal], async () => {
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

  if (projectStore.projectPath) {
    // Save restored column because selectPhase(0) resets it
    const restoredColumn = uiStore.selectedColumn
    const rootIndex = uiStore.selectedPhaseByColumn[0] ?? 0

    // Load all project data first
    await dataStore.loadProject(projectStore.projectPath);

    // Build search index
    await trpc.project.buildSearchIndex.mutate({
      projectPath: projectStore.projectPath
    });

    // Then, select the first root phase (index 0 in column 0) to kick off the cascade
    await uiStore.selectPhase(0, rootIndex);
    
    // Restore column focus
    uiStore.setSelectedColumn(restoredColumn);
    
    uiStore.ensureSelectionVisible();
  } else {
    // Set initial focus to the first phase column
    uiStore.setSelectedColumn(0);
    await refreshDiscoveredProjects()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})

</script>

<template>
  <div class="app">
    <!-- Header -->
    <header v-if="!projectStore.isInProjectSelection" class="header">
      <div class="status">
        <span class="connection-status" :class="projectStore.connectionStatus">
          {{ projectStore.connectionStatus === 'connected' ? 'Connected to' : projectStore.connectionStatus }}
          {{ projectStore.connectionStatus === 'connected' ? 'aimparency server' : '' }}
        </span>
        
        <div class="column-controls" v-if="projectStore.currentView === 'columns'">
          <button @click="uiStore.setViewportSize(uiStore.viewportSize - 1)" class="icon-btn" title="Decrease columns">-</button>
          <span>{{ uiStore.viewportSize }} columns</span>
          <button @click="uiStore.setViewportSize(uiStore.viewportSize + 1)" class="icon-btn" title="Increase columns">+</button>
        </div>

        <div class="view-controls">
          <button 
            @click="uiStore.setView('columns')" 
            :class="{ active: projectStore.currentView === 'columns' }"
            class="view-btn"
          >Columns</button>
          <button 
            @click="uiStore.setView('graph')" 
            :class="{ active: projectStore.currentView === 'graph' }"
            class="view-btn"
          >Graph</button>
          <button 
            v-if="voiceEnabled"
            @click="uiStore.setView('voice')" 
            :class="{ active: projectStore.currentView === 'voice' }"
            class="view-btn"
          >Voice</button>
        </div>

        <button 
          @click="projectStore.showWatchdog = !projectStore.showWatchdog" 
          class="icon-btn" 
          style="width: auto; padding: 0 0.5rem;"
          :style="{ background: projectStore.showWatchdog ? '#444' : 'transparent' }"
          title="Toggle Watchdog Panel"
        >
          Watchdog
        </button>

        <div class="project-info">
          <div v-if="projectStore.projectPath" class="project-location" :title="`${normalizedProjectRoot}\n${activeBowmanRoot}`">
            <div class="project-chip">
              <span class="project-chip-label">Project</span>
              <span class="project-chip-value">{{ activeProjectName }}</span>
            </div>
            <div class="project-path-stack">
              <span class="project-path-line">
                <span class="project-path-label">root</span>
                <code>{{ normalizedProjectRoot }}</code>
              </span>
              <span class="project-path-line">
                <span class="project-path-label">.bowman</span>
                <code>{{ activeBowmanRoot }}</code>
              </span>
            </div>
          </div>

          <button @click="modalStore.openSettingsModal()" class="icon-btn" title="Project Settings" style="width: auto; padding: 0 0.5rem; font-size: 0.9rem;">
            ⚙️
          </button>

          <button 
            v-if="projectStore.projectPath"
            class="consistency-btn"
            :class="{ 'has-errors': dataStore.consistencyErrors.length > 0 }"
            @click="showConsistencyModal = true"
            :title="dataStore.consistencyErrors.length > 0 ? 'Data Inconsistencies Found' : 'Data is Consistent'"
          >
            {{ dataStore.consistencyErrors.length > 0 ? '×' : '✓' }}
          </button>

          <button 
            v-if="projectStore.projectPath"
            class="icon-btn"
            title="Refresh Consistency Check"
            @click="dataStore.checkConsistency(projectStore.projectPath)"
            style="font-size: 0.7rem; margin-left: 2px"
          >
            🔄
          </button>
        </div>

        <a @click="closeProject" class="close-project">Switch Project</a>
      </div>
    </header>

    <ProjectSelectionView
      v-if="projectStore.isInProjectSelection"
      v-model="projectPathInput"
      :project-history="projectStore.projectHistory"
      :discovered-projects="discoveredProjects"
      :scanned-roots="discoveredProjectRoots"
      :is-refreshing-discovered-projects="isRefreshingDiscoveredProjects"
      @select-project="handleSelectProject"
      @open-project-from-history="openProjectFromHistory"
      @remove-from-history="removeFromHistory"
      @refresh-discovered-projects="refreshDiscoveredProjects"
      @open-discovered-project="openDiscoveredProject"
    />

    <!-- Main Interface -->
    <div v-else class="main-split">
      <main class="content-area" v-show="!(projectStore.showWatchdog && projectStore.watchdogMaximized)">
        <!-- Columns View -->
        <ColumnsView v-if="projectStore.currentView === 'columns'" />

        <!-- Graph View -->
        <GraphViewWrapper v-else-if="projectStore.currentView === 'graph'" />

        <!-- Voice View -->
        <VoiceView v-else-if="voiceEnabled && projectStore.currentView === 'voice'" />
      </main>

      <!-- Watchdog Panel -->
      <div 
        v-if="projectStore.showWatchdog" 
        class="watchdog-container" 
        :style="{ height: projectStore.watchdogMaximized ? '100%' : watchdogHeight + 'px' }"
      >
        <div class="resize-handle" v-if="!projectStore.watchdogMaximized" @mousedown="startResizeWatchdog"></div>
        <WatchdogPanel ref="watchdogRef" />
      </div>
    </div>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal />
    
    <!-- Aim Creation Modal -->
    <AimCreationModal v-if="modalStore.showAimModal" />

    <!-- Aim Edit Modal -->
    <AimEditModal
      :show="modalStore.showAimEditModal"
      :aim-id="modalStore.aimEditModalAimId"
      @close="modalStore.closeAimEditModal()"
    />

    <!-- Aim Search Modal -->
    <AimSearchModal
      v-if="modalStore.showAimSearch"
      @select="handleAimSearchSelect"
      @close="modalStore.closeAimSearch()"
    />
    <PhaseSearchModal
      v-if="modalStore.showPhaseSearchPrompt"
      :title="modalStore.phaseSearchPromptTitle"
      :placeholder="modalStore.phaseSearchPromptPlaceholder"
      :additional-options="modalStore.phaseSearchPromptAdditionalOptions"
      @select="handlePhaseSearchSelect"
      @close="modalStore.closePhaseSearchPrompt()"
    />

    <!-- Consistency Modal -->
    <ConsistencyModal 
        v-if="showConsistencyModal" 
        @close="showConsistencyModal = false" 
    />

    <ProjectSettingsModal v-if="modalStore.showSettingsModal" />

    <!-- Help Text -->
    <footer v-if="!projectStore.isInProjectSelection" class="help">
      <div class="help-keys">
        <div v-for="hint in projectStore.keyboardHints" :key="`${hint.key}-${hint.action}`" class="hint">
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
  gap: 0.5rem;
  min-width: 0;
}

.project-location {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.2rem 0.45rem;
  border: 1px solid #3f3f3f;
  border-radius: 0.4rem;
  background: #252525;
}

.project-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.1rem;
  padding-right: 0.45rem;
  border-right: 1px solid #3f3f3f;
  flex-shrink: 0;
}

.project-chip-label,
.project-path-label {
  color: #7f7f7f;
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.project-chip-value {
  color: #f0f0f0;
  font-size: 0.86rem;
}

.project-path-stack {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.project-path-line {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
}

.project-path-line code {
  color: #b6d7ff;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.76rem;
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
