<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { Phase } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { trpc } from '../trpc'
import AimComponent from './Aim.vue'
import PhaseColumn from './PhaseColumn.vue'

interface Props {
  phase: Phase
  isSelected: boolean
  columnIndex: number
  columnDepth?: number
  pageFrom: number
  pageTo: number
}

const props = withDefaults(defineProps<Props>(), {
  columnDepth: 1
})

const emit = defineEmits<{
  focused: []
}>()

const dataStore = useDataStore()
const uiStore = useUIStore()

// Template refs
const phaseRef = ref<HTMLElement | null>(null)
const aimsContainerRef = ref<HTMLElement | null>(null)
const aimRefs = ref<InstanceType<typeof AimComponent>[]>([])
const childColumnRef = ref<InstanceType<typeof PhaseColumn> | null>(null)

// Local state
const inAimEditMode = ref(false)
const focusedAimIndex = ref(0)
const ignoreNextFocus = ref(false)
const showEditModal = ref(false)
const showCreateAimModal = ref(false)

// Child column state
const childPhases = ref<Phase[]>([])

// Get aims for this phase
const phaseAims = computed(() => {
  return dataStore.getPhaseAims(props.phase.id) || []
})

// Check if this phase is pending delete
const isPendingDelete = computed(() => {
  return uiStore.pendingDeletePhaseId === props.phase.id
})

// Focus methods
const focusByParent = () => {
  if (inAimEditMode.value && aimRefs.value.length > 0) {
    // In edit mode - focus the selected aim
    const targetAim = aimRefs.value[focusedAimIndex.value] || aimRefs.value[0]
    targetAim?.focusByParent()
  } else {
    // Normal mode - focus the phase itself
    if (document.activeElement === phaseRef.value) return
    ignoreNextFocus.value = true
    phaseRef.value?.focus()
  }
}

const focusChildColumn = () => {
  childColumnRef.value?.focusByParent()
}

const blurByParent = () => {
  // Blur children first
  if (inAimEditMode.value) {
    const focusedAim = aimRefs.value[focusedAimIndex.value]
    focusedAim?.blurByParent()
  }
  childColumnRef.value?.blurByParent()

  // Then blur self
  phaseRef.value?.blur()
}

// Focus event handlers
const handleFocus = () => {
  if (ignoreNextFocus.value) {
    ignoreNextFocus.value = false
    return
  }

  emit('focused')
}

const handleAimFocused = (index: number) => {
  focusedAimIndex.value = index
  scrollAimIntoView(index)
}

// Mode transitions
const enterAimEditMode = () => {
  inAimEditMode.value = true
  updateKeyboardHints()

  // Focus first aim
  nextTick(() => {
    if (aimRefs.value.length > 0) {
      focusedAimIndex.value = 0
      aimRefs.value[0]?.focusByParent()
    }
  })
}

const exitAimEditMode = () => {
  inAimEditMode.value = false
  updateKeyboardHints()

  // Focus phase itself
  phaseRef.value?.focus()
}

// Aim navigation (only when in edit mode)
const navigateAimDown = () => {
  if (focusedAimIndex.value < phaseAims.value.length - 1) {
    uiStore.clearPendingDelete()
    focusedAimIndex.value++
    aimRefs.value[focusedAimIndex.value]?.focusByParent()
  }
}

const navigateAimUp = () => {
  if (focusedAimIndex.value > 0) {
    uiStore.clearPendingDelete()
    focusedAimIndex.value--
    aimRefs.value[focusedAimIndex.value]?.focusByParent()
  }
}

// Keyboard handling
const handleKeydown = (e: KeyboardEvent) => {
  // Mode-specific keys
  if (inAimEditMode.value) {
    // Aim edit mode
    switch (e.key) {
      case 'j':
        e.preventDefault()
        navigateAimDown()
        break
      case 'k':
        e.preventDefault()
        navigateAimUp()
        break
      case 'o':
      case 'O':
        e.preventDefault()
        openCreateAimModal()
        break
      case 'd':
        e.preventDefault()
        handleDeleteAim()
        break
      case 'Escape':
        e.preventDefault()
        exitAimEditMode()
        break
    }
  } else {
    // Normal phase mode
    switch (e.key) {
      case 'i':
        e.preventDefault()
        enterAimEditMode()
        break
      case 'e':
        e.preventDefault()
        openEditModal()
        break
      // j/k/d are handled by parent (PhaseColumn)
    }
  }
}

// Modal management
const openEditModal = () => {
  showEditModal.value = true
  // TODO: Implement modal integration in Phase 7
}

const openCreateAimModal = () => {
  showCreateAimModal.value = true
  // TODO: Implement modal integration in Phase 7
}

// Delete handling
const handleDeleteAim = () => {
  const aimIndex = focusedAimIndex.value
  if (uiStore.pendingDeleteAimIndex === aimIndex) {
    // Confirm delete
    deleteAim(aimIndex)
    uiStore.clearPendingDelete()
  } else {
    // First press - mark for deletion
    uiStore.setPendingDeleteAim(aimIndex)
  }
}

const deleteAim = async (aimIndex: number) => {
  const aim = phaseAims.value[aimIndex]
  if (!aim) return

  try {
    await trpc.aim.removeFromPhase.mutate({
      projectPath: uiStore.projectPath,
      aimId: aim.id,
      phaseId: props.phase.id
    })

    // Reload phase aims
    await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)

    // Adjust focus
    if (phaseAims.value.length === 0) {
      // No more aims, exit edit mode
      exitAimEditMode()
    } else if (focusedAimIndex.value >= phaseAims.value.length) {
      // Was last aim, move to previous
      focusedAimIndex.value = phaseAims.value.length - 1
      await nextTick()
      aimRefs.value[focusedAimIndex.value]?.focusByParent()
    }
  } catch (error) {
    console.error('Failed to delete aim:', error)
  }
}

// Scroll into view (1/4 to 3/4 viewport)
const scrollAimIntoView = async (aimIndex: number) => {
  await nextTick()

  const container = aimsContainerRef.value
  if (!container) return

  const aimElement = aimRefs.value[aimIndex]?.$el || aimRefs.value[aimIndex]
  if (!aimElement) return

  const containerRect = container.getBoundingClientRect()
  const aimRect = aimElement.getBoundingClientRect()

  const viewportHeight = window.innerHeight
  const quarterMark = viewportHeight * 0.25
  const threeQuarterMark = viewportHeight * 0.75

  const isAboveRange = aimRect.top < quarterMark
  const isBelowRange = aimRect.bottom > threeQuarterMark

  if (!isAboveRange && !isBelowRange) return

  let targetScroll = container.scrollTop

  if (isBelowRange) {
    const offset = aimRect.bottom - threeQuarterMark
    targetScroll += offset
  } else if (isAboveRange) {
    const offset = aimRect.top - quarterMark
    targetScroll += offset
  }

  const maxScroll = container.scrollHeight - container.clientHeight
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
}

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
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } else if (months < 6) {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } else if (duration < 30 * 365 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  } else {
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

  if (now < from) return 0
  if (now > to) return 100

  return ((now - from) / (to - from)) * 100
})

// Computed progress color (cyan to pink gradient)
const progressColor = computed(() => {
  const percent = progressPercent.value / 100
  const r = Math.round(percent * 255)
  const g = Math.round((1 - percent) * 255)
  const b = 255
  return `rgb(${r}, ${g}, ${b})`
})

// Keyboard hints
const keyboardHints = ref<Record<string, string>>({
  'i': 'enter phase aims',
  'e': 'edit phase'
})

const updateKeyboardHints = () => {
  if (inAimEditMode.value) {
    keyboardHints.value = {
      'j': 'next aim',
      'k': 'prev aim',
      'o': 'create aim',
      'd': 'delete aim',
      'Esc': 'leave phase aims'
    }
  } else {
    keyboardHints.value = {
      'i': 'enter phase aims',
      'e': 'edit phase'
    }
  }
}

let unregisterHints: (() => void) | null = null

onMounted(async () => {
  await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
  unregisterHints = uiStore.registerKeyboardHints(keyboardHints)
})

onUnmounted(() => {
  unregisterHints?.()
})

// Expose methods
defineExpose({
  focusByParent,
  blurByParent,
  focusChildColumn
})
</script>

<template>
  <div
    ref="phaseRef"
    class="phase-container focusable"
    :class="{ 'pending-delete': isPendingDelete }"
    tabindex="0"
    @focus="handleFocus"
    @keydown="handleKeydown"
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
    <div ref="aimsContainerRef" class="aims-container">
      <div v-if="phaseAims.length === 0" class="empty-hint">
        No aims yet. Press i then o to create
      </div>
      <AimComponent
        v-for="(aim, index) in phaseAims"
        :key="aim.id"
        :ref="el => { if (el) aimRefs[index] = el as InstanceType<typeof AimComponent> }"
        :aim="aim"
        :class="{
          'pending-delete': uiStore.pendingDeleteAimIndex === index && inAimEditMode
        }"
        @focused="handleAimFocused(index)"
      />
    </div>
  </div>

  <!-- Teleport child column when this phase is selected -->
  <Teleport to=".main" v-if="isSelected">
    <PhaseColumn
      ref="childColumnRef"
      :phases="childPhases"
      :column-index="columnIndex + 1"
      :column-depth="columnDepth + 1"
      :parent-phase="phase"
      :page-from="pageFrom"
      :page-to="pageTo"
      :style="childColumnStyle"
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
