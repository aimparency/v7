<script setup lang="ts">
import { computed, watch, nextTick } from 'vue'
import type { Phase } from 'shared'
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

// Compute phases for this column based on parent phase ID
const phases = computed(() => dataStore.getPhasesByParentId(props.parentPhaseId))

// Compute which phase in this column is visually selected
const selectedPhase = computed(() => {
  if (phases.value.length === 0) return null
  return phases.value[props.selectedPhaseIndex] ?? phases.value[0]
})

// When this column becomes selected, update rightmost column tracking
watch(() => props.isSelected, (isSelected) => {
  if (isSelected) {
    if (phases.value.length === 0) {
      uiStore.setRightmostColumn(props.columnIndex)
    } else {
      uiStore.setMinRightmost(props.columnIndex + 1)
    }
  }
}, { immediate: true })

// When selected phase changes, report it to the store
watch(() => [selectedPhase.value, props.selectedPhaseIndex] as const, ([phase, index]) => {
  if (phase) {
    uiStore.setSelectedPhase(props.columnIndex, index, phase.id)
  }
}, { immediate: true })



// Load phases when parentPhaseId changes
watch(() => props.parentPhaseId, (parentPhaseId) => {
  if (parentPhaseId) {
    dataStore.loadPhases(uiStore.projectPath, parentPhaseId)
  }
}, { immediate: true })

// Report phase count to store whenever phases change
watch(() => phases.value, (phasesArray) => {
  uiStore.setPhaseCount(props.columnIndex, phasesArray.length)
}, { immediate: true })
</script>

<template>
  <div class="phase-column" :class="{ 'selected-outlined': isActive, 'selected': isSelected }">
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
        @click="() => uiStore.setSelectedPhase(columnIndex, index, phase.id)"
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
