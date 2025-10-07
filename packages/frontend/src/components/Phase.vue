<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Phase } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { trpc } from '../trpc'
import AimComponent from './Aim.vue'
import PhaseColumn from './PhaseColumn.vue'

interface Props {
  phase: Phase
  isSelected: boolean
  isActive: boolean
  columnIndex: number
  columnDepth?: number
}

const props = withDefaults(defineProps<Props>(), {
  columnDepth: 1
})

const dataStore = useDataStore()
const uiStore = useUIStore()

// Child column state
const childPhases = ref<Phase[]>([])

// Get aims for this phase
const phaseAims = computed(() => {
  return dataStore.getPhaseAims(props.phase.id)
})

// Load child phases for teleported column
const loadChildPhases = async () => {
  try {
    const phases = await trpc.phase.list.query({
      projectPath: uiStore.projectPath,
      parentPhaseId: props.phase.id
    })
    childPhases.value = phases
  } catch (error) {
    console.error('Failed to load child phases:', error)
    childPhases.value = []
  }
}

// Load child phases when this phase is selected
watch(() => props.isSelected, async (isSelected) => {
  if (isSelected) {
    await loadChildPhases()
  }
}, { immediate: true })

// Calculate column positioning for child
const childColumnStyle = computed(() => {
  const childColumnIndex = props.columnIndex + 1
  const leftOffset = childColumnIndex * 50
  return {
    position: 'absolute',
    left: `${leftOffset}%`,
    top: '0',
    width: '50%',
    height: '100%',
    zIndex: childColumnIndex + 1
  }
})

// Load aims on mount
onMounted(async () => {
  await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
})
</script>

<template>
  <div class="phase-container" :class="{ 'is-active': isActive, 'is-selected': isSelected && !isActive }">
    <!-- Phase Header -->
    <div class="phase-header">
      <div class="phase-name">{{ phase.name }}</div>
    </div>

    <!-- Aims List -->
    <div class="aims-container">
      <AimComponent
        v-for="(aim, index) in phaseAims"
        :key="aim.id"
        :aim="aim"
        :class="{
          'is-selected-aim': uiStore.selectedAim?.phaseId === phase.id && uiStore.selectedAim?.aimIndex === index
        }"
      />
    </div>
  </div>

  <!-- Teleport child column when this phase is selected -->
  <Teleport to=".main" v-if="isSelected">
    <PhaseColumn
      :phases="childPhases"
      :column-index="columnIndex + 1"
      :column-depth="columnDepth + 1"
      :parent-phase="phase"
      :style="childColumnStyle"
      :is-selected="uiStore.selectedColumn === columnIndex + 1"
      :is-active="uiStore.selectedColumn === columnIndex + 1"
      :selected-phase-index="uiStore.getSelectedPhase(columnIndex + 1)"
    />
  </Teleport>
</template>

<style scoped>
.phase-container {
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: #2a2a2a;
  cursor: pointer;
}

.phase-container.is-active {
  background: #333;
  outline: 0.15rem solid #007acc;
}

.phase-container.is-selected {
  background: #2d2d2d;
  outline: 0.15rem solid #555;
}

.phase-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.phase-name {
  font-weight: bold;
  color: #e0e0e0;
}

.aims-container {
  padding-left: 1rem;
}

.is-selected-aim {
  outline: 0.15rem solid #007acc;
  border-radius: 0.25rem;
}
</style>
