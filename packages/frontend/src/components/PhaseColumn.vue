<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useScrollIntoView } from '../composables/useScrollIntoView'
import PhaseComponent from './Phase.vue'

interface Props {
  columnIndex: number
  isSelected: boolean
  isActive: boolean
  selectedPhaseIndex: number
}

const props = defineProps<Props>()

const dataStore = useDataStore()
const uiStore = useUIStore()

const phaseListRef = ref<HTMLElement | null>(null)

const entries = computed(() => dataStore.getPhaseLevelEntries(props.columnIndex))
const selectableEntries = computed(() => dataStore.getSelectablePhaseLevelEntries(props.columnIndex))

const getSelectableIndex = (entryKey: string) => {
  return selectableEntries.value.findIndex((entry) => entry.key === entryKey)
}

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
    <div v-if="entries.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div v-else ref="phaseListRef" class="phase-list">
      <template v-for="entry in entries" :key="entry.key">
        <hr v-if="entry.type === 'separator'" class="parent-separator" />
        <div
          v-else-if="entry.type === 'placeholder'"
          class="phase-placeholder"
          :class="{
            'selected-item': getSelectableIndex(entry.key) === selectedPhaseIndex,
            'active-item': getSelectableIndex(entry.key) === selectedPhaseIndex && uiStore.selectedColumn === columnIndex
          }"
          @click="() => uiStore.selectPhase(columnIndex, getSelectableIndex(entry.key))"
        >
          no sub phases yet. press o to create one
        </div>
        <PhaseComponent
          v-else
          :phase="entry.phase"
          :is-selected="getSelectableIndex(entry.key) === selectedPhaseIndex"
          :is-active="getSelectableIndex(entry.key) === selectedPhaseIndex && uiStore.selectedColumn === columnIndex"
          @phase-clicked="() => uiStore.selectPhase(columnIndex, getSelectableIndex(entry.key))"
          @aim-clicked="(aimId) => uiStore.selectAimById(columnIndex, entry.phase.id, aimId)"
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

.parent-separator {
  border: 0;
  border-top: 1px solid #555;
  margin: 0.5rem 0;
}

.phase-placeholder {
  margin-bottom: 0.5rem;
  padding: 0.75rem;
  border: 1px dashed #555;
  border-radius: 0.25rem;
  color: #888;
  font-style: italic;
  cursor: pointer;
}

.phase-placeholder.selected-item {
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;
}

.phase-placeholder.active-item {
  outline-color: #007acc;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}
</style>
