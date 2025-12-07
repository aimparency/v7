<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useDataStore, type Phase} from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimsList from './AimsList.vue'

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

// Get aims from the store
const phaseAims = computed(() => dataStore.getAimsForPhase(props.phase.id))

// Watch for selection (both active and non-active) and emit scroll request
watch(() => props.isActive || props.isSelected, (shouldScroll) => {
  if (shouldScroll && phaseContainerRef.value) {
    emit('scroll-request', phaseContainerRef.value)
  }
}, { flush: 'post' })

// Load aims and scroll on mount
onMounted(() => {
  dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)

  if ((props.isActive || props.isSelected) && phaseContainerRef.value) {
    emit('scroll-request', phaseContainerRef.value)
  }
})

// Format date with appropriate granularity based on duration
const formatDate = (timestamp: number, duration: number): string => {
  const date = new Date(timestamp)
  const hours = duration / (60 * 60 * 1000)
  const days = duration / (24 * 60 * 60 * 1000)
  const months = days / 30

  if (hours < 6) {
    // < 6h: show HH:mm
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    // < 7d: show DD HH
    return date.toLocaleTimeString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
</script>

<template>
  <div
    ref="phaseContainerRef"
    class="phase-container"
    :class="{ 'selected-outlined': isActive, 'selected': isSelected, 'pending-delete': isPendingDelete }"
    @click="$emit('phase-clicked')"
  >
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
      <AimsList
        :aims="phaseAims"
        :phase-id="phase.id"
        :column-index="0"
        :is-active="isActive && uiStore.navigatingAims"
        :is-selected="isSelected && uiStore.navigatingAims"
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
  margin-bottom: 0.5rem;
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  overflow: hidden;
}

.phase-container.selected {
  outline: 2px solid #888;
}

.phase-container.selected-outlined {
  outline: 2px solid #007acc;
}

.progress-bar {
  height: 0.3rem;
  background: #333;
  width: 100%;
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
