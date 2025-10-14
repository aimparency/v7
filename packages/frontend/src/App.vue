<script setup lang="ts">
import { ref, onMounted, nextTick, computed, watch } from 'vue'
import type { Phase } from 'shared'
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
const appRef = ref<HTMLDivElement | null>(null)
const projectPathInput = ref('')

// Get root phases from the store
const rootPhases = computed(() => dataStore.getPhasesByParentId(null))

// Container offset based on viewport start from store
const containerOffset = computed(() => {
  const columnWidth = 50 // Each column is 50% wide
  const offset = uiStore.viewportStart * columnWidth
  return `translateX(-${offset}%)`
})

const selectProject = async (path: string) => {
  await dataStore.loadProject(path)
}

const handleSelectProject = () => {
  const path = projectPathInput.value.trim()
  selectProject(path)
}

const openProjectFromHistory = async (path: string) => {
  projectPathInput.value = path
  await selectProject(path)
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

const handlePhaseSelected = (columnIndex: number, phaseIndex: number, phaseId: string) => {
  uiStore.setSelectedPhase(columnIndex, phaseIndex, phaseId)

  // When a phase is selected, lazy-load its children
  dataStore.loadPhases(uiStore.projectPath, phaseId)

  // Handle sub-phase selection persistence
  if (columnIndex > 1) {
    const parentColumn = columnIndex - 1
    const parentPhaseId = uiStore.getSelectedPhaseId(parentColumn)
    if (parentPhaseId) {
      uiStore.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = phaseIndex
    }
  }
}


// Global keyboard handler - single source of truth for all navigation
const handleGlobalKeydown = (event: KeyboardEvent) => {
  console.log('Key pressed:', event.key, 'mode:', uiStore.mode, 'column:', uiStore.selectedColumn)

  // Don't handle keys when modals are open
  if (uiStore.showPhaseModal || uiStore.showAimModal) return

  const mode = uiStore.mode

  if (mode === 'column-navigation') {
    handleColumnNavigationKeys(event)
  } else if (mode === 'phase-edit') {
    handlePhaseEditKeys(event)
  } else if (mode === 'aim-edit') {
    handleAimEditKeys(event)
  }
}

// Column navigation mode: h/l = change column, j/k = navigate phases, i = enter edit
const handleColumnNavigationKeys = async (event: KeyboardEvent) => {
  await uiStore.handleColumnNavigationKeys(event, dataStore)
}


// Phase edit mode: j/k = navigate aims, Esc = exit, h/l = expand/collapse, d = delete, o/O = create
const handlePhaseEditKeys = async (event: KeyboardEvent) => {
  const selectedAim = uiStore.selectedAim

  // Allow Escape even when no aims exist
  if (event.key === 'Escape') {
    event.preventDefault()
    uiStore.clearPendingDelete()

    // Save last selected aim index for root aims
    if (selectedAim?.phaseId === 'null') {
      uiStore.setSelectedPhase(0, selectedAim.aimIndex)
    }

    uiStore.setMode('column-navigation')
    uiStore.setSelectedAim(null, null)
    return
  }

  // Allow o/O even when no aims exist (for creating first aim)
  if (event.key === 'o' || event.key === 'O') {
    event.preventDefault()
    if (!selectedAim) return
    const aims = dataStore.getAimsForPhase(selectedAim.phaseId)
    const insertionIndex = (aims && aims.length > 0)
      ? (event.key === 'o' ? selectedAim.aimIndex + 1 : selectedAim.aimIndex)
      : 0
    uiStore.openAimModal(selectedAim.phaseId, insertionIndex)
    return
  }

  if (!selectedAim) return

  const aims = dataStore.getAimsForPhase(selectedAim.phaseId)
  // Allow o/O even when no aims exist (for creating first sub-phase)

  // Ensure selected index is valid
  if (selectedAim.aimIndex >= aims.length) {
    // Fix invalid selection
    const validIndex = Math.min(selectedAim.aimIndex, aims.length - 1)
    uiStore.setSelectedAim(selectedAim.phaseId, validIndex)
    if (selectedAim.phaseId !== 'null') {
      uiStore.lastSelectedAimIndexByPhase[selectedAim.phaseId] = validIndex
    } else {
      uiStore.lastSelectedRootAimIndex = validIndex
    }
    return
  }

  switch (event.key) {
    case 'j': {
      event.preventDefault()
      if (selectedAim.aimIndex < aims.length - 1) {
        const newIndex = selectedAim.aimIndex + 1
        uiStore.setSelectedAim(selectedAim.phaseId, newIndex)
        if (selectedAim.phaseId !== 'null') {
          uiStore.lastSelectedAimIndexByPhase[selectedAim.phaseId] = newIndex
        } else {
          uiStore.lastSelectedRootAimIndex = newIndex
        }
        await uiStore.scrollIntoViewIfNeeded()
      }
      uiStore.clearPendingDelete() // Navigation cancels pending delete

      // Store sub-phase selection for persistence
      if (uiStore.selectedColumn > 1) {
        const parentColumn = uiStore.selectedColumn - 1
        const parentPhaseId = uiStore.getSelectedPhaseId(parentColumn)
        if (parentPhaseId) {
          console.log(`Storing sub-phase selection: parent ${parentPhaseId} -> index ${uiStore.getSelectedPhase(uiStore.selectedColumn)}`)
          uiStore.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = uiStore.getSelectedPhase(uiStore.selectedColumn)
        }
      }
      break
    }
    case 'k': {
      event.preventDefault()
      if (selectedAim.aimIndex > 0) {
        const newIndex = selectedAim.aimIndex - 1
        uiStore.setSelectedAim(selectedAim.phaseId, newIndex)
        if (selectedAim.phaseId !== 'null') {
          uiStore.lastSelectedAimIndexByPhase[selectedAim.phaseId] = newIndex
        } else {
          uiStore.lastSelectedRootAimIndex = newIndex
        }
        await uiStore.scrollIntoViewIfNeeded()
      }
      uiStore.clearPendingDelete() // Navigation cancels pending delete

      // Store sub-phase selection for persistence
      if (uiStore.selectedColumn > 1) {
        const parentColumn = uiStore.selectedColumn - 1
        const parentPhaseId = uiStore.getSelectedPhaseId(parentColumn)
        if (parentPhaseId) {
          console.log(`Storing sub-phase selection: parent ${parentPhaseId} -> index ${uiStore.getSelectedPhase(uiStore.selectedColumn)}`)
          uiStore.lastSelectedSubPhaseIndexByPhase[parentPhaseId] = uiStore.getSelectedPhase(uiStore.selectedColumn)
        }
      }
      break
    }
    case 'e': {
      event.preventDefault()
      // Get the selected aim
      const aim = aims[selectedAim.aimIndex]
      if (aim) {
        uiStore.openAimEditModal(aim.id, selectedAim.phaseId, selectedAim.aimIndex)
      }
      break
    }
    case 'd': {
      event.preventDefault()
      // Check if this is confirmation (second press)
      if (uiStore.pendingDeleteAimIndex === selectedAim.aimIndex) {
        // Confirm delete
        await dataStore.deleteAim(aims[selectedAim.aimIndex].id, selectedAim.phaseId)
        uiStore.clearPendingDelete()
      } else {
        // First press - mark for deletion
        uiStore.setPendingDeleteAim(selectedAim.aimIndex)
      }
      break
    }
    case 'h':
      event.preventDefault()
      // TODO: Collapse aim
      break
    case 'l':
      event.preventDefault()
      // TODO: Expand aim or navigate to child column
      break
  }
}


// Aim edit mode: field editing
const handleAimEditKeys = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    uiStore.setMode('phase-edit')
  }
}

// Update keyboard hints based on mode and selected column
watch(() => [uiStore.mode, uiStore.selectedColumn], ([mode, selectedColumn]) => {
  if (mode === 'column-navigation') {
    const hints = [
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
  } else if (mode === 'phase-edit') {
    uiStore.setKeyboardHints([
      { key: 'j/k', action: 'navigate aims' },
      { key: 'h/l', action: 'collapse/expand' },
      { key: 'e', action: 'edit aim' },
      { key: 'd', action: 'delete aim' },
      { key: 'o/O', action: 'create aim below/above' },
      { key: 'Esc', action: 'exit edit mode' }
    ])
  } else if (mode === 'aim-edit') {
    uiStore.setKeyboardHints([
      { key: 'Esc', action: 'exit aim edit' }
    ])
  }
}, { immediate: true })

// Watch for modal close and restore focus
watch(() => [uiStore.showPhaseModal, uiStore.showAimModal], async () => {
  // When both modals are closed, restore focus to app
  if (!uiStore.showPhaseModal && !uiStore.showAimModal) {
    await nextTick()
    appRef.value?.focus()
  }
})

onMounted(async () => {
  uiStore.setSelectedColumn(0)

  if (uiStore.projectPath) {
    await selectProject(uiStore.projectPath)

    // Set initial root aim selection to last remembered position, clamped to valid range
    const aims = dataStore.getAimsForPhase('null') || []
    const validIndex = Math.min(uiStore.lastSelectedRootAimIndex, Math.max(0, aims.length - 1))
    uiStore.setSelectedPhase(0, validIndex)
  } else {
    // No project loaded, default to 0
    uiStore.setSelectedPhase(0, 0)
  }

  // Auto-focus app element for keyboard navigation
  await nextTick()
  appRef.value?.focus()
})

</script>

<template>
  <div ref="appRef" class="app" tabindex="0" @keydown="handleGlobalKeydown">
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
    <main v-else class="main" :style="{ transform: containerOffset }">
      <!-- Root Aims Column (Column 0) -->
      <RootAimsColumn
        class="column-0"
        :is-selected="uiStore.selectedColumn === 0"
        :is-active="uiStore.selectedColumn === 0"
      />

      <!-- First Phase Column (Column 1) -->
      <PhaseColumn
        :phases="rootPhases"
        :column-index="1"
        :column-depth="1"
        :parent-phase="null"
        class="column-1"
        :is-selected="uiStore.selectedColumn === 1"
        :is-active="uiStore.selectedColumn === 1"
        :selected-phase-index="uiStore.getSelectedPhase(1)"
        @phase-selected="handlePhaseSelected"
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
  font-family: monospace;
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
  font-family: monospace;
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

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: visible;
  position: relative;
  transition: transform 0.3s ease;
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
  border-radius: 0.1875rem;
  font-size: 0.8rem;
  font-family: monospace;
}

/* Global styles */
kbd {
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 0.1875rem;
  font-size: 0.8rem;
  font-family: monospace;
}
</style>