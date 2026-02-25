<script setup lang="ts">
import type { ProjectHistoryEntry } from '../stores/ui/project-helpers'

const props = defineProps<{
  modelValue: string
  projectHistory: ProjectHistoryEntry[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'select-project'): void
  (event: 'open-project-from-history', path: string): void
  (event: 'remove-from-history', path: string): void
}>()

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
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

    <div v-if="props.projectHistory.length > 0" class="project-history">
      <h3>Recent Projects</h3>
      <div class="history-list">
        <div
          v-for="project in props.projectHistory"
          :key="project.path"
          class="history-item"
          :class="{ failed: project.failedToLoad }"
          @click="emit('open-project-from-history', project.path)"
        >
          <div class="history-item-content">
            <div class="history-path">{{ project.path }}</div>
            <div class="history-time">{{ formatRelativeTime(project.lastOpened) }}</div>
          </div>
          <button
            class="remove-button"
            @click.stop="emit('remove-from-history', project.path)"
            title="Remove from history"
          >×</button>
        </div>
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

.project-history h3 {
  margin: 0;
  font-size: 1rem;
  color: #ccc;
}

.history-list {
  max-height: 20rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.history-list::-webkit-scrollbar {
  width: 0.375rem;
}

.history-list::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.history-list::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 0.1875rem;
}

.history-list::-webkit-scrollbar-thumb:hover {
  background: #666;
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
}

.remove-button:hover {
  color: #ff6666;
}
</style>
