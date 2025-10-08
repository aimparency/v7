<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import type { Phase } from 'shared'
import { useUIStore, type Hint } from './stores/ui'
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
const projectPathInput = ref('')

// Root phases for the first phase column
const rootPhases = ref<Phase[]>([])

// Local viewport state
const viewportStart = ref(0)
const viewportSize = 2 // Number of columns visible at once
const currentFocusedPage = ref(0) // Track which page/column is currently focused

// Compute page range
const pageFrom = computed(() => viewportStart.value)
const pageTo = computed(() => viewportStart.value + viewportSize - 1)

// Focus column by index
const focusColumnByIndex = (columnIndex: number) => {
  if (columnIndex === 0) {
    rootAimsColumnRef.value?.focusByParent()
  } else if (columnIndex === 1) {
    firstPhaseColumnRef.value?.focusByParent()
  }
  // For deeper columns (2+), they handle their own focus via teleport
  // when their parent phase receives focus
}

// Container offset for smooth scrolling
const containerOffset = computed(() => {
  const columnWidth = 50 // Each column is 50% wide
  const offset = viewportStart.value * columnWidth
  return `translateX(-${offset}%)`
})

// Project management
const selectProject = async () => {
  const path = projectPathInput.value.trim()
  if (!path) return

  try {
    uiStore.setProjectPath(path)
    uiStore.setConnectionStatus('connecting')
    await loadRootPhases(path)
    await dataStore.loadPhaseAims(path, 'null')
    uiStore.setConnectionStatus('connected')
    uiStore.addProjectToHistory(path)
    uiStore.clearProjectFailure(path)

    // Focus first column after loading
    currentFocusedPage.value = 0
    await nextTick()
    focusColumnByIndex(0)
  } catch (error) {
    console.error('Failed to load project:', error)
    uiStore.setConnectionStatus('no connection')
    uiStore.markProjectAsFailed(path)
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
    rootPhases.value = phases.sort((a, b) => a.from - b.from)
  } catch (error) {
    console.error('Failed to load root phases:', error)
    rootPhases.value = []
  }
}

const closeProject = () => {
  rootPhases.value = []
  uiStore.setProjectPath('')
  viewportStart.value = 0
  currentFocusedPage.value = 0
}

// Page navigation handling
const handlePageNavigation = async (delta: number) => {
  const targetPage = currentFocusedPage.value + delta

  // TODO: Track rightmost column dynamically
  // For now, allow navigation but clamp to reasonable bounds
  const maxPage = 10 // Arbitrary max for now
  if (targetPage < 0 || targetPage > maxPage) return

  // Edge-triggered viewport scrolling
  const viewportEnd = viewportStart.value + viewportSize - 1

  if (targetPage > viewportEnd) {
    // Scroll right to include targetPage as the rightmost visible page
    viewportStart.value = targetPage - viewportSize + 1
  } else if (targetPage < viewportStart.value) {
    // Scroll left to include targetPage as the leftmost visible page
    viewportStart.value = targetPage
  }
  // If targetPage is within [viewportStart, viewportEnd], no scrolling needed

  // Update current focused page
  currentFocusedPage.value = targetPage

  // Focus target column
  await nextTick()
  focusColumnByIndex(targetPage)
}

onMounted(async () => {
  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await loadRootPhases(uiStore.projectPath)
    await dataStore.loadPhaseAims(uiStore.projectPath, 'null')
    uiStore.setConnectionStatus('connected')

    // Focus first column
    currentFocusedPage.value = 0
    await nextTick()
    focusColumnByIndex(0)
  }
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
    <main v-else class="main">
      <div class="viewport" :style="{ transform: containerOffset }">
        <!-- Root Aims Column (Column 0) -->
        <RootAimsColumn
          ref="rootAimsColumnRef"
          class="column-0"
          :page-from="pageFrom"
          :page-to="pageTo"
          @page-navigation="handlePageNavigation"
        />

        <!-- First Phase Column (Column 1) -->
        <PhaseColumn
          ref="firstPhaseColumnRef"
          :phases="rootPhases"
          :column-index="1"
          :column-depth="1"
          :parent-phase="null"
          :page-from="pageFrom"
          :page-to="pageTo"
          class="column-1"
          @page-navigation="handlePageNavigation"
        />
      </div>
    </main>

    <!-- Phase Creation Modal -->
    <PhaseCreationModal
      :show="false"
      mode="create"
    />

    <!-- Aim Creation Modal -->
    <AimCreationModal
      :show="false"
      mode="create"
      :phase-id="null"
    />

    <!-- Help Text -->
    <footer v-if="!uiStore.isInProjectSelection" class="help">
      <div class="help-keys">
        <div v-for="hint in uiStore.activeKeyboardHints" :key="`${hint.key}-${hint.action}`" class="hint">
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
  overflow: hidden;
}

.viewport {
  display: flex;
  flex-direction: column;
  overflow: visible;
  position: relative;
  transition: transform 0.3s ease;
  width: 200%; /* 2 columns * 100% each */
  height: 100%;
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
</style>
