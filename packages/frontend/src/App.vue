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

// Root phases for the first phase column
const rootPhases = ref<Phase[]>([])

// Container offset based on viewport start from store
const containerOffset = computed(() => {
  const columnWidth = 50 // Each column is 50% wide
  const offset = uiStore.viewportStart * columnWidth
  return `translateX(-${offset}%)`
})

const selectProject = async () => {
  const path = projectPathInput.value.trim()
  if (!path) return

  try {
    uiStore.setProjectPath(path)
    uiStore.setConnectionStatus('connecting')
    // Load root phases for first phase column
    await loadRootPhases(path)
    await dataStore.loadPhaseAims(path, 'null')
    uiStore.setConnectionStatus('connected')
    // Success - add to history and clear any failure status
    uiStore.addProjectToHistory(path)
    uiStore.clearProjectFailure(path)
  } catch (error) {
    console.error('Failed to load project:', error)
    uiStore.setConnectionStatus('no connection')
    uiStore.markProjectAsFailed(path)
    // Don't clear projectPath so user can see the error
  }
}

const openProjectFromHistory = async (path: string) => {
  projectPathInput.value = path
  await selectProject()
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

const loadRootPhases = async (projectPath: string) => {
  try {
    const phases = await trpc.phase.list.query({
      projectPath,
      parentPhaseId: null
    })
    // Sort phases by 'from' date ascending
    rootPhases.value = phases.sort((a: Phase, b: Phase) => a.from - b.from)
  } catch (error) {
    console.error('Failed to load root phases:', error)
    rootPhases.value = []
  }
}

const closeProject = () => {
  // Clear root phases to unmount Phase components before clearing project path
  rootPhases.value = []
  uiStore.setProjectPath('')
}

const handlePhaseCreated = async (columnIndex: number) => {
  // Reload the phase list for the column where the phase was created
  if (columnIndex === 1) {
    // Reload root phases for column 1
    await loadRootPhases(uiStore.projectPath)
  } else {
    // For deeper columns (2+), trigger a global phase reload
    // This will cause all Phase components to reload their child phases
    uiStore.triggerPhaseReload()
  }
}

// Scroll selected element into 1/4 to 3/4 viewport range
const scrollIntoViewIfNeeded = async () => {
  await nextTick()

  // Find the active column's scrollable container
  const container = document.querySelector('.is-active .phase-list, .is-active .aims-list') as HTMLElement
  if (!container) return

  // Find the selected element
  const selected = container.querySelector('.phase-container.is-active, .is-selected-aim') as HTMLElement
  if (!selected) return

  const selectedRect = selected.getBoundingClientRect()

  const viewportHeight = window.innerHeight
  const quarterMark = viewportHeight * 0.25
  const threeQuarterMark = viewportHeight * 0.75

  // Check if element is outside 1/4 to 3/4 range
  const isAboveRange = selectedRect.top < quarterMark
  const isBelowRange = selectedRect.bottom > threeQuarterMark

  if (!isAboveRange && !isBelowRange) return

  // Calculate target scroll position to keep element in range
  let targetScroll = container.scrollTop

  if (isBelowRange) {
    // Scroll down: position element so its bottom is at 3/4 mark
    const offset = selectedRect.bottom - threeQuarterMark
    targetScroll += offset
  } else if (isAboveRange) {
    // Scroll up: position element so its top is at 1/4 mark
    const offset = selectedRect.top - quarterMark
    targetScroll += offset
  }

  // Clamp to valid scroll range
  const maxScroll = container.scrollHeight - container.clientHeight
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
}

// Global keyboard handler - single source of truth for all navigation
const handleGlobalKeydown = (event: KeyboardEvent) => {
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
  switch (event.key) {
    case 'h':
      event.preventDefault()
      uiStore.navigateLeft()
      break
    case 'l':
      event.preventDefault()
      uiStore.navigateRight()
      break
    case 'j': {
      event.preventDefault()
      uiStore.clearPendingDelete() // Navigation cancels pending delete
      const col = uiStore.selectedColumn
      const currentPhaseIndex = uiStore.getSelectedPhase(col)
      const maxIndex = col === 0
        ? (dataStore.getPhaseAims('null')?.length ?? 0) - 1
        : uiStore.getPhaseCount(col) - 1
      if (currentPhaseIndex < maxIndex) {
        uiStore.setSelectedPhase(col, currentPhaseIndex + 1)
        scrollIntoViewIfNeeded()
      }
      break
    }
    case 'k': {
      event.preventDefault()
      uiStore.clearPendingDelete() // Navigation cancels pending delete
      const col = uiStore.selectedColumn
      const currentPhaseIndex = uiStore.getSelectedPhase(col)
      if (currentPhaseIndex > 0) {
        uiStore.setSelectedPhase(col, currentPhaseIndex - 1)
        scrollIntoViewIfNeeded()
      }
      break
    }
    case 'i': {
      event.preventDefault()
      // Get the selected phase to enter edit mode
      const col = uiStore.selectedColumn
      let phaseId: string | null = null

      if (col === 0) {
        // Root aims column - use 'null' as phase ID
        phaseId = 'null'
      } else {
        // For all phase columns (1+), check if there are any phases
        const phaseCount = uiStore.getPhaseCount(col)
        if (phaseCount === 0) {
          // No phases to edit aims in
          break
        }
        // Get the selected phase ID from store
        phaseId = uiStore.getSelectedPhaseId(col)
      }

      if (phaseId) {
        uiStore.setMode('phase-edit')
        uiStore.setSelectedAim(phaseId, 0)
      }
      break
    }
    case 'e': {
      event.preventDefault()
      const col = uiStore.selectedColumn

      // Can't edit in root aims column
      if (col === 0) break

      // Get selected phase ID and fetch phase data
      const selectedPhaseId = uiStore.getSelectedPhaseId(col)
      if (!selectedPhaseId) break

      const selectedPhase = await trpc.phase.get.query({
        projectPath: uiStore.projectPath,
        phaseId: selectedPhaseId
      })

      if (!selectedPhase) break

      uiStore.openPhaseEditModal(
        selectedPhase.id,
        selectedPhase.name,
        selectedPhase.from,
        selectedPhase.to,
        col
      )
      break
    }
    case 'o':
    case 'O':
      event.preventDefault()
      if (uiStore.selectedColumn === 0) {
        uiStore.openAimModal()
      } else {
        // Determine parent phase based on selected column
        const targetColumn = uiStore.selectedColumn
        let parentPhaseId: string | null = null
        const selectedIndex = uiStore.getSelectedPhase(targetColumn)

        if (targetColumn === 1) {
          // Creating in column 1 -> parent is null (root phase)
          parentPhaseId = null
        } else {
          // Creating in column 2+ -> parent is the selected phase in column to the left
          const parentColumn = targetColumn - 1
          parentPhaseId = uiStore.getSelectedPhaseId(parentColumn)
        }

        uiStore.openPhaseModal(targetColumn, parentPhaseId, selectedIndex)
      }
      break
    case 'd': {
      event.preventDefault()
      const col = uiStore.selectedColumn

      // Only allow deleting phases (not root aims column)
      if (col === 0) break

      // Get selected phase ID from store
      const selectedPhaseId = uiStore.getSelectedPhaseId(col)
      if (!selectedPhaseId) break

      // Get the actual phase object to access its parent
      // We need to fetch it since we only have the ID
      const selectedPhase = await trpc.phase.get.query({
        projectPath: uiStore.projectPath,
        phaseId: selectedPhaseId
      })

      if (!selectedPhase) break

      // Check if this is confirmation (second press)
      if (uiStore.pendingDeletePhaseId === selectedPhase.id) {
        // Confirm delete
        await deletePhase(selectedPhase.id, selectedPhase.parent)
        uiStore.clearPendingDelete()
      } else {
        // First press - mark for deletion
        uiStore.setPendingDeletePhase(selectedPhase.id)
      }
      break
    }
  }
}

const deletePhase = async (phaseId: string, parentPhaseId: string | null) => {
  try {
    // Get child phases and update their parent
    const childPhases = await trpc.phase.list.query({
      projectPath: uiStore.projectPath,
      parentPhaseId: phaseId
    })

    for (const child of childPhases) {
      await trpc.phase.update.mutate({
        projectPath: uiStore.projectPath,
        phaseId: child.id,
        phase: { parent: parentPhaseId }
      })
    }

    // Delete the phase
    await trpc.phase.delete.mutate({
      projectPath: uiStore.projectPath,
      phaseId: phaseId
    })

    // Reload phases
    if (parentPhaseId === null) {
      await loadRootPhases(uiStore.projectPath)
    } else {
      uiStore.triggerPhaseReload()
    }
  } catch (error) {
    console.error('Failed to delete phase:', error)
  }
}

// Phase edit mode: j/k = navigate aims, Esc = exit, h/l = expand/collapse, d = delete, o/O = create
const handlePhaseEditKeys = async (event: KeyboardEvent) => {
  const selectedAim = uiStore.selectedAim

  // Allow Escape even when no aims exist
  if (event.key === 'Escape') {
    event.preventDefault()
    uiStore.clearPendingDelete()
    uiStore.setMode('column-navigation')
    uiStore.setSelectedAim(null, null)
    return
  }

  // Allow o/O even when no aims exist (for creating first aim)
  if (event.key === 'o' || event.key === 'O') {
    event.preventDefault()
    if (!selectedAim) return
    const aims = dataStore.getPhaseAims(selectedAim.phaseId)
    const insertionIndex = (aims && aims.length > 0)
      ? (event.key === 'o' ? selectedAim.aimIndex + 1 : selectedAim.aimIndex)
      : 0
    uiStore.openAimModal(selectedAim.phaseId, insertionIndex)
    return
  }

  if (!selectedAim) return

  const aims = dataStore.getPhaseAims(selectedAim.phaseId)
  if (!aims || aims.length === 0) return

  switch (event.key) {
    case 'j': {
      event.preventDefault()
      uiStore.clearPendingDelete() // Navigation cancels pending delete
      if (selectedAim.aimIndex < aims.length - 1) {
        uiStore.setSelectedAim(selectedAim.phaseId, selectedAim.aimIndex + 1)
        scrollIntoViewIfNeeded()
      }
      break
    }
    case 'k': {
      event.preventDefault()
      uiStore.clearPendingDelete() // Navigation cancels pending delete
      if (selectedAim.aimIndex > 0) {
        uiStore.setSelectedAim(selectedAim.phaseId, selectedAim.aimIndex - 1)
        scrollIntoViewIfNeeded()
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
        await deleteAim(aims[selectedAim.aimIndex].id, selectedAim.phaseId)
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

const deleteAim = async (aimId: string, phaseId: string) => {
  try {
    // Delete the aim entirely (removes from all phases and deletes the file)
    await trpc.aim.delete.mutate({
      projectPath: uiStore.projectPath,
      aimId: aimId
    })

    // Reload phase aims
    await dataStore.loadPhaseAims(uiStore.projectPath, phaseId)

    // Adjust selection if needed
    if (uiStore.selectedAim) {
      const aims = dataStore.getPhaseAims(phaseId)
      if (aims.length === 0) {
        // No more aims, exit phase-edit mode
        uiStore.setMode('column-navigation')
        uiStore.setSelectedAim(null, null)
      } else if (uiStore.selectedAim.aimIndex >= aims.length) {
        // Selected aim was last, move to previous
        uiStore.setSelectedAim(phaseId, aims.length - 1)
      }
    }
  } catch (error) {
    console.error('Failed to delete aim:', error)
  }
}

// Aim edit mode: field editing
const handleAimEditKeys = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    uiStore.setMode('phase-edit')
  }
}

// Update keyboard hints based on mode
watch(() => uiStore.mode, (mode) => {
  if (mode === 'column-navigation') {
    uiStore.setKeyboardHints([
      { key: 'h/l', action: 'switch columns' },
      { key: 'j/k', action: 'navigate phases/aims' },
      { key: 'i', action: 'enter edit mode' },
      { key: 'e', action: 'edit phase' },
      { key: 'o', action: 'create phase/aim' }
    ])
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
  uiStore.setSelectedPhase(0, 0)

  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await loadRootPhases(uiStore.projectPath)
    await dataStore.loadPhaseAims(uiStore.projectPath, 'null')
    uiStore.setConnectionStatus('connected')
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
          @keydown.enter="selectProject"
        />
        <button @click="selectProject" class="select-project">Open Project</button>
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
        :selected-index="uiStore.getSelectedPhase(0)"
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
      />
    </main>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal @phase-created="handlePhaseCreated" />
    
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