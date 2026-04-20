<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useDataStore, type Phase} from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useProjectStore } from '../stores/project-store'
import AimsList from './AimsList.vue'
import { perfLog } from '../utils/perf-log'

interface Props {
  phase: Phase
  isSelected: boolean
  isActive: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'scroll-request': [element: HTMLElement]
  'aim-clicked': [aimId: string]
  'phase-clicked': []
}>()

const phaseContainerRef = ref<HTMLElement | null>(null)

const dataStore = useDataStore()
const uiStore = useUIStore()
const projectStore = useProjectStore()

// Get aims from the store
const phaseAims = computed(() => dataStore.getAimsForPhase(props.phase.id))

// Load aims and scroll on mount
onMounted(() => {
  perfLog('phase.mount', {
    phaseId: props.phase.id,
    phaseName: props.phase.name,
    isSelected: props.isSelected,
    isActive: props.isActive
  })
  dataStore.loadPhaseAims(projectStore.projectPath, props.phase.id)
})

// Check if this phase is pending delete
const isPendingDelete = computed(() => {
  return uiStore.pendingDeletePhaseId === props.phase.id
})
</script>

<template>
  <div
    ref="phaseContainerRef"
    class="phase-container"
    :class="{ 'active': isActive, 'selected': isSelected, 'pending-delete': isPendingDelete }"
    @click="$emit('phase-clicked')"
  >
    <div class="phase-header">
      <div class="phase-name">{{ phase.name }}</div>
    </div>

    <!-- Aims List -->
    <div class="aims-container">
      <AimsList
        :aims="phaseAims"
        :phase-id="phase.id"
        :column-index="0"
        :is-active="isActive && uiStore.navigatingAims"
        :is-selected="isSelected"
        :selected-aim-index="phase.selectedAimIndex"
        @scroll-request="$emit('scroll-request', $event)"
        @aim-clicked="$emit('aim-clicked', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-container {
  padding: 0;
  margin-bottom: 0;
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  overflow: hidden;
}

.phase-container.selected {
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;

  &.active {
    outline-color: #007acc;
  }
}

.phase-container.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}

.phase-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  padding-top: 0.3rem;
}

.phase-name {
  font-weight: bold;
  color: #e0e0e0;
}

.aims-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 0 0.5rem;
}

.empty-hint {
  font-size: 0.7rem;
  color: #666;
  font-style: italic;
  padding: 0.25rem 0;
}

.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}
</style>
