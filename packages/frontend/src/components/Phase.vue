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
    // Sort phases by 'from' date ascending
    childPhases.value = phases.sort((a, b) => a.from - b.from)
  } catch (error) {
    console.error('Failed to load child phases:', error)
    childPhases.value = []
  }
}

// Load child phases when this phase is selected or when force reload is triggered
watch(() => [props.isSelected, uiStore.phaseReloadTrigger] as const, async ([isSelected]) => {
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

// Format date with appropriate granularity based on duration
const formatDate = (timestamp: number, duration: number): string => {
  const date = new Date(timestamp)
  const minutes = duration / (60 * 1000)
  const hours = duration / (60 * 60 * 1000)
  const days = duration / (24 * 60 * 60 * 1000)
  const months = days / 30

  if (hours < 6) {
    // < 6h: show HH:mm
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    // < 7d: show HH:mm
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } else if (months < 6) {
    // < 6mo: show DD MMM (strip year)
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } else if (duration < 30 * 365 * 24 * 60 * 60 * 1000) {
    // < 30y: show MMM YYYY
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  } else {
    // ≥ 30y: show YYYY
    return date.getFullYear().toString()
  }
}

// Computed date range display
const dateRangeDisplay = computed(() => {
  const duration = props.phase.to - props.phase.from
  const start = formatDate(props.phase.from, duration)
  const end = formatDate(props.phase.to, duration)
  return `${start} - ${end}`
})

// Computed progress percentage
const progressPercent = computed(() => {
  const now = Date.now()
  const { from, to } = props.phase

  if (now < from) return 0 // Future phase
  if (now > to) return 100 // Past phase

  return ((now - from) / (to - from)) * 100
})

// Computed progress color (cyan to pink gradient)
const progressColor = computed(() => {
  const percent = progressPercent.value / 100
  // Interpolate from cyan (0,1,1) to pink (1,0,1)
  const r = Math.round(percent * 255)
  const g = Math.round((1 - percent) * 255)
  const b = 255
  return `rgb(${r}, ${g}, ${b})`
})

// Check if this phase is pending delete
const isPendingDelete = computed(() => {
  return uiStore.pendingDeletePhaseId === props.phase.id
})

// Load aims on mount
onMounted(async () => {
  await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
})
</script>

<template>
  <div class="phase-container" :class="{ 'selected-outlined': isActive || isSelected, 'pending-delete': isPendingDelete }">
    <!-- Progress Bar -->
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: progressPercent + '%', background: progressColor }"></div>
    </div>

    <!-- Phase Header -->
    <div class="phase-header">
      <div class="phase-name">
        {{ phase.name }}
        <span class="phase-dates">{{ dateRangeDisplay }}</span>
      </div>
    </div>

    <!-- Aims List -->
    <div class="aims-container">
      <div v-if="!phaseAims || phaseAims.length === 0" class="empty-hint">
        No aims yet. Press o to create
      </div>
      <AimComponent
        v-for="(aim, index) in phaseAims"
        :key="aim.id"
        :aim="aim"
        :class="{
          'selected-outlined': uiStore.selectedAim?.phaseId === phase.id && uiStore.selectedAim?.aimIndex === index,
          'pending-delete': uiStore.pendingDeleteAimIndex === index && uiStore.selectedAim?.phaseId === phase.id
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
  padding: 0;
  margin-bottom: 0.5rem;
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  overflow: hidden;
}

.progress-bar {
  height: 0.3rem;
  background: #333;
  width: 100%;
  position: relative;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease, background 0.3s ease;
}

.phase-container.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}

.phase-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  padding: 0.5rem;
  padding-top: 0.3rem;
}

.phase-name {
  font-weight: bold;
  color: #e0e0e0;
}

.phase-dates {
  font-weight: normal;
  font-size: 0.7rem;
  color: #888;
  margin-left: 0.5rem;
  white-space: nowrap;
}

.aims-container {
  padding-left: 1rem;
  padding-right: 0.5rem;
  padding-bottom: 0.5rem;
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
