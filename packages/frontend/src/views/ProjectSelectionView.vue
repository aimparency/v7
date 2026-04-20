<script setup lang="ts">
import type { ProjectHistoryEntry } from '../stores/ui/project-helpers'

type DiscoveredProject = {
  path: string
  bowmanPath: string
  sourceRoot: string
}

const props = defineProps<{
  modelValue: string
  projectHistory: ProjectHistoryEntry[]
  discoveredProjects: DiscoveredProject[]
  scannedRoots: string[]
  isRefreshingDiscoveredProjects: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'select-project'): void
  (event: 'open-project-from-history', path: string): void
  (event: 'remove-from-history', path: string): void
  (event: 'refresh-discovered-projects'): void
  (event: 'open-discovered-project', path: string): void
}>()

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

const loadPathIntoInput = (path: string) => {
  emit('update:modelValue', path)
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
</script>

<template>
  <div class="project-selection">
    <h1>Aimparency</h1>
    <p>Select a project base folder to get started</p>

    <div class="project-input-container">
      <input
        :value="props.modelValue"
        type="text"
        placeholder="Enter project folder path..."
        class="project-input"
        @input="onInput"
        @keydown.enter="emit('select-project')"
      />
      <button @click="emit('select-project')" class="select-project">Open Project</button>
    </div>

    <div class="project-lists">
      <div v-if="props.projectHistory.length > 0" class="project-history">
        <h3>Recent Projects</h3>
        <div class="history-list">
          <div
            v-for="project in props.projectHistory"
            :key="project.path"
            class="history-item"
            :class="{ failed: project.failedToLoad }"
          >
            <button
              type="button"
              class="edit-button"
              title="Edit path before opening"
              aria-label="Edit path before opening"
              @click.stop="loadPathIntoInput(project.path)"
            >✎</button>
            <button
              type="button"
              class="history-open-button"
              @click="emit('open-project-from-history', project.path)"
            >
              <div class="history-item-content">
                <div class="history-path">{{ project.path }}</div>
                <div class="history-time">{{ formatRelativeTime(project.lastOpened) }}</div>
              </div>
            </button>
            <button
              class="remove-button"
              @click.stop="emit('remove-from-history', project.path)"
              title="Remove from history"
            >×</button>
          </div>
        </div>
      </div>

      <div class="project-discovery">
        <div class="section-header">
          <h3>Nearby .bowman Projects</h3>
          <button
            class="refresh-button"
            :disabled="props.isRefreshingDiscoveredProjects"
            @click="emit('refresh-discovered-projects')"
          >
            {{ props.isRefreshingDiscoveredProjects ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <p class="discovery-hint" v-if="props.scannedRoots.length > 0">
          Scanned {{ props.scannedRoots.join(', ') }}
        </p>

        <div v-if="props.discoveredProjects.length > 0" class="history-list">
          <div
            v-for="project in props.discoveredProjects"
            :key="project.path"
            class="history-item discovered-item"
          >
            <button
              type="button"
              class="edit-button"
              title="Edit path before opening"
              aria-label="Edit path before opening"
              @click.stop="loadPathIntoInput(project.path)"
            >✎</button>
            <button
              type="button"
              class="history-open-button"
              @click="emit('open-discovered-project', project.path)"
            >
              <div class="history-item-content">
                <div class="history-primary">
                  <div class="history-path">{{ project.path }}</div>
                  <div class="history-bowman">{{ project.bowmanPath }}</div>
                </div>
                <div class="history-time">from {{ project.sourceRoot }}</div>
              </div>
            </button>
          </div>
        </div>
        <p v-else class="empty-state">No nearby projects found yet.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
}

.project-input:focus {
  outline: none;
  border-color: #007acc;
}

.project-input::placeholder {
  color: #666;
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
}

.project-lists {
  width: 100%;
  max-height: 20rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding-right: 0.25rem;
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.project-discovery {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.project-history h3,
.section-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #ccc;
}

.refresh-button {
  background: transparent;
  color: #ccc;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

.refresh-button:hover:not(:disabled) {
  background: #2d2d2d;
}

.refresh-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.discovery-hint,
.empty-state {
  margin: 0;
  color: #888;
  font-size: 0.85rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.project-lists::-webkit-scrollbar {
  width: 0.375rem;
}

.project-lists::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.project-lists::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 0.1875rem;
}

.project-lists::-webkit-scrollbar-thumb:hover {
  background: #666;
}

.history-item {
  width: 100%;
  display: flex;
  align-items: center;
  background: #2d2d2d;
  border: 1px solid #444;
  border-radius: 0.3125rem;
  transition: background 0.2s;
  overflow: hidden;
}

.discovered-item {
  border-color: #3b5269;
}

.history-item:hover {
  background: #333;
}

.history-item.failed {
  border-color: #ff666644;
}

.history-item.failed .history-path {
  color: #ff6666;
}

.history-open-button {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem 0.75rem 0.25rem;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
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

.history-primary {
  min-width: 0;
}

.history-bowman {
  color: #7ea8d6;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  font-size: 0.8rem;
  color: #888;
  white-space: nowrap;
}

.edit-button {
  flex: 0 0 auto;
  align-self: stretch;
  width: 2.5rem;
  background: transparent;
  border: none;
  border-right: 1px solid #3b3b3b;
  color: #8ea9c4;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.edit-button:hover {
  background: #253140;
  color: #d6e6f7;
}

.remove-button {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  color: #888;
  font-size: 1.5rem;
  cursor: pointer;
  align-self: stretch;
  padding: 0 0.75rem;
  line-height: 1;
  transition: color 0.2s;
}

.remove-button:hover {
  color: #ff6666;
}
</style>
