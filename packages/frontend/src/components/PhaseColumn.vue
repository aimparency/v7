<script setup lang="ts">
import { computed, watch, nextTick } from 'vue'
import type { Phase } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import PhaseComponent from './Phase.vue'

interface Props {
  phases: Phase[]
  columnIndex: number
  columnDepth?: number
  parentPhase?: Phase | null
  isSelected: boolean
  isActive: boolean
  selectedPhaseIndex: number
}

const props = withDefaults(defineProps<Props>(), {
  columnDepth: 1,
  parentPhase: null
})

const dataStore = useDataStore()
const uiStore = useUIStore()

// Compute which phase in this column is visually selected
const selectedPhase = computed(() => {
  if (props.phases.length === 0) return null
  return props.phases[props.selectedPhaseIndex] ?? props.phases[0]
})

// When this column becomes selected, ensure rightmost column tracking is updated
watch(() => props.isSelected, (isSelected) => {
  if (isSelected) {
    if (props.phases.length === 0) {
      uiStore.setRightmostColumn(props.columnIndex)
    } else {
      uiStore.setMinRightmost(props.columnIndex + 1)
    }
  }
}, { immediate: true })

// When selected phase changes, load its child phases
watch(() => selectedPhase.value, async (phase) => {
  if (!phase) return
  // Child phases will be loaded by the Phase component via teleport
}, { immediate: true })
</script>

<template>
  <div class="phase-column" :class="{ 'is-active': isActive, 'is-selected': isSelected && !isActive }">
    <div v-if="phases.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div v-else class="phase-list">
      <PhaseComponent
        v-for="(phase, index) in phases"
        :key="phase.id"
        :phase="phase"
        :is-selected="index === selectedPhaseIndex"
        :is-active="isActive && index === selectedPhaseIndex"
        :column-index="columnIndex"
        :column-depth="columnDepth"
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

.phase-column.is-active {
  outline: 0.15rem solid #007acc;
}

.phase-column.is-selected {
  outline: 0.15rem solid #555;
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
