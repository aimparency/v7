<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import PhaseComponent from './Phase.vue'

interface Props {
  parentPhaseId: string | null
  columnIndex: number
  columnDepth?: number
  isSelected: boolean
  isActive: boolean
  selectedPhaseIndex: number
}

const props = withDefaults(defineProps<Props>(), {
  columnDepth: 1
})

const dataStore = useDataStore()
const uiStore = useUIStore()

const phaseListRef = ref<HTMLElement | null>(null)

// Compute phases for this column based on parent phase ID
const phases = computed(() => dataStore.getPhasesByParentId(props.parentPhaseId))

// Handle scroll requests from child components
const handleScrollRequest = (element: HTMLElement) => {
  if (!phaseListRef.value) return

  const container = phaseListRef.value
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  // Calculate 1/4 to 3/4 range
  const minY = containerRect.top + containerRect.height * 0.25
  const maxY = containerRect.top + containerRect.height * 0.75

  // Check if element is outside the range
  const isAboveRange = elementRect.top < minY
  const isBelowRange = elementRect.bottom > maxY

  if (!isAboveRange && !isBelowRange) return

  // Calculate target scroll position
  let targetScroll = container.scrollTop

  if (isBelowRange) {
    const offset = elementRect.bottom - maxY
    targetScroll += offset
  } else if (isAboveRange) {
    const offset = elementRect.top - minY
    targetScroll += offset
  }

  // Clamp to valid scroll range
  const maxScroll = container.scrollHeight - container.clientHeight
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
}
</script>

<template>
  <div class="phase-column" :class="{ 'selected-outlined': isActive, 'selected': isSelected }">
    <div v-if="phases.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div v-else ref="phaseListRef" class="phase-list">
      <PhaseComponent
        v-for="(phase, index) in phases"
        :key="phase.id"
        :phase="phase"
        :is-selected="index === selectedPhaseIndex"
        :is-active="isActive && index === selectedPhaseIndex"
        :column-index="columnIndex"
        :column-depth="columnDepth"
        @click="() => uiStore.selectPhase(columnIndex, index)"
        @scroll-request="handleScrollRequest"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.phase-column.selected {
  outline: 2px solid #888;
}

.phase-column.selected-outlined {
  outline: 2px solid #007acc;
}

.phase-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;

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

  /* Firefox scrollbar */
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}
</style>
