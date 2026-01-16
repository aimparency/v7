<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useScrollIntoView } from '../composables/useScrollIntoView'
import PhaseComponent from './Phase.vue'

interface Props {
  parentPhaseId: string | null
  columnIndex: number
  isSelected: boolean
  isActive: boolean
  selectedPhaseIndex: number
}

const props = defineProps<Props>()

const dataStore = useDataStore()
const uiStore = useUIStore()

const phaseListRef = ref<HTMLElement | null>(null)

// Compute phases for this column based on parent phase ID
const phases = computed(() => dataStore.getPhasesByParentId(props.parentPhaseId))

// Handle scroll requests from child components
const { handleScrollRequest } = useScrollIntoView(phaseListRef)

watch(() => uiStore.columnScrollRequest, (req) => {
  if (req && req.col === props.columnIndex && phaseListRef.value) {
    const behavior = 'smooth'
    if (req.direction === 'bottom') {
      phaseListRef.value.scrollTo({ top: phaseListRef.value.scrollHeight, behavior })
    } else if (req.direction === 'top') {
      phaseListRef.value.scrollTo({ top: 0, behavior })
    }
  }
})
</script>

<template>
  <div class="phase-column" :class="{ 'active': isActive, 'selected': isSelected }">
    <div v-if="phases.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div v-else ref="phaseListRef" class="phase-list">
      <template v-for="(phase, index) in phases" :key="phase.id">
        <PhaseComponent
          v-if="phase"
          :phase="phase"
          :is-selected="index === selectedPhaseIndex"
          :is-active="index === selectedPhaseIndex && uiStore.selectedColumn === columnIndex"
          @phase-clicked="() => uiStore.selectPhase(columnIndex, index)"
          @aim-clicked="(aimId) => uiStore.selectAimById(columnIndex, phase.id, aimId)"
          @scroll-request="handleScrollRequest"
        />
      </template>
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
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;

  &.active {
    outline-color: #007acc;
  }
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
