<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
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

// Container offset based on viewport start from store
const containerOffset = computed(() => {
  const columnWidth = 50 // Each column is 50% wide
  const offset = uiStore.viewportStart * columnWidth
  return `translateX(-${offset}%)`
})

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
const handleColumnNavigationKeys = (event: KeyboardEvent) => {
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
      const col = uiStore.selectedColumn
      const currentPhaseIndex = uiStore.getSelectedPhase(col)
      const maxIndex = col === 0 ? (dataStore.getPhaseAims('null')?.length ?? 0) - 1 : (rootPhases.value.length - 1)
      if (currentPhaseIndex < maxIndex) {
        uiStore.setSelectedPhase(col, currentPhaseIndex + 1)
      }
      break
    }
    case 'k': {
      event.preventDefault()
      const col = uiStore.selectedColumn
      const currentPhaseIndex = uiStore.getSelectedPhase(col)
      if (currentPhaseIndex > 0) {
        uiStore.setSelectedPhase(col, currentPhaseIndex - 1)
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
      } else if (col === 1 && rootPhases.value.length > 0) {
        // First phase column
        const selectedPhase = rootPhases.value[uiStore.getSelectedPhase(col)]
        phaseId = selectedPhase?.id ?? null
      }
      // TODO: Handle deeper columns

      if (phaseId) {
        uiStore.setMode('phase-edit')
        uiStore.setSelectedAim(phaseId, 0)
      }
      break
    }
    case 'o':
    case 'O':
      event.preventDefault()
      if (uiStore.selectedColumn === 0) {
        uiStore.openAimModal()
      } else {
        uiStore.openPhaseModal(uiStore.selectedColumn, null)
      }
      break
  }
}

// Phase edit mode: j/k = navigate aims, Esc = exit, h/l = expand/collapse
const handlePhaseEditKeys = (event: KeyboardEvent) => {
  const selectedAim = uiStore.selectedAim
  if (!selectedAim) return

  const aims = dataStore.getPhaseAims(selectedAim.phaseId)
  if (!aims || aims.length === 0) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      uiStore.setMode('column-navigation')
      uiStore.setSelectedAim(null, null)
      break
    case 'j': {
      event.preventDefault()
      if (selectedAim.aimIndex < aims.length - 1) {
        uiStore.setSelectedAim(selectedAim.phaseId, selectedAim.aimIndex + 1)
      }
      break
    }
    case 'k': {
      event.preventDefault()
      if (selectedAim.aimIndex > 0) {
        uiStore.setSelectedAim(selectedAim.phaseId, selectedAim.aimIndex - 1)
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

// Update keyboard hints based on mode
watch(() => uiStore.mode, (mode) => {
  if (mode === 'column-navigation') {
    uiStore.setKeyboardHints([
      { key: 'h/l', action: 'switch columns' },
      { key: 'j/k', action: 'navigate phases/aims' },
      { key: 'i', action: 'enter edit mode' },
      { key: 'o', action: 'create phase/aim' }
    ])
  } else if (mode === 'phase-edit') {
    uiStore.setKeyboardHints([
      { key: 'j/k', action: 'navigate aims' },
      { key: 'h/l', action: 'collapse/expand' },
      { key: 'o', action: 'create aim' },
      { key: 'Esc', action: 'exit edit mode' }
    ])
  } else if (mode === 'aim-edit') {
    uiStore.setKeyboardHints([
      { key: 'Esc', action: 'exit aim edit' }
    ])
  }
}, { immediate: true })

onMounted(async () => {
  uiStore.setSelectedColumn(0)
  uiStore.setSelectedPhase(0, 0)

  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await loadRootPhases(uiStore.projectPath)
    await dataStore.loadPhaseAims(uiStore.projectPath, 'null')
    uiStore.setConnectionStatus('connected')
  }
})

</script>

<template>
  <div class="app" tabindex="0" @keydown="handleGlobalKeydown">
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
  border-radius: 0.3125rem;
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
  overflow: visible;
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