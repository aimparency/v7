<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import type { Phase } from 'shared'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import AimComponent from './Aim.vue'

interface Props {
  phase: Phase
  isSelected?: boolean
  isInEditMode?: boolean
  columnType: 'left' | 'right'
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false,
  isInEditMode: false
})

const uiStore = useUIStore()
const dataStore = useDataStore()


const displayAims = computed(() => {
  return true // Always display aims for both columns
})

const phaseAims = computed(() => {
  return dataStore.getPhaseAims(props.phase.id)
})

// Load aims when this phase is selected (for both columns)
watch(() => props.isSelected, async (newVal) => {
  if (newVal) {
    await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
  }
})

// Load aims on mount if this phase is already selected
onMounted(async () => {
  if (props.isSelected) {
    await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
  }
})
</script>

<template>
  <div 
    class="phase-container"
    :class="{ 
      selected: isSelected
    }"
  >
    <!-- Phase Header -->
    <div class="phase-header">
      <div class="phase-name">{{ phase.name }}</div>
    </div>
    
    <!-- Aims List (always shown for both columns) -->
    <div v-if="displayAims" class="aims-container">
      <AimComponent
        v-for="(aim, index) in phaseAims"
        :key="aim.id"
        :aim="aim"
        :is-selected="isInEditMode && index === uiStore.selectedAimIndex"
        :is-expanded="uiStore.expandedAims.has(aim.id)"
        :indentation-level="0"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-container {
  padding: 0.5rem;
  margin-bottom: 0.25rem;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &.selected {
    background: #2a2a2a;
  }
  
  &:hover:not(.selected) {
    background: #333;
  }
}

.phase-header {
  .phase-name {
    font-weight: bold;
  }
}

.aims-container {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>