<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import type { Phase } from 'shared'
import { useUIStore } from '../stores/ui'
import PhaseComponent from './Phase.vue'

interface Props {
  phases: Phase[]
  columnIndex: number
  columnDepth?: number
  parentPhase?: Phase | null
  pageFrom: number
  pageTo: number
}

const props = withDefaults(defineProps<Props>(), {
  columnDepth: 1,
  parentPhase: null
})

const emit = defineEmits<{
  pageNavigation: [delta: number]
}>()

const uiStore = useUIStore()

// Template refs
const columnRef = ref<HTMLElement | null>(null)
const phaseListRef = ref<HTMLElement | null>(null)
const phaseRefs = ref<InstanceType<typeof PhaseComponent>[]>([])

// Local state
const focusedPhaseIndex = ref(0)
const showCreateModal = ref(false)
const ignoreNextFocus = ref(false)

// Compute visibility
const isVisible = computed(() => {
  return props.columnIndex >= props.pageFrom && props.columnIndex <= props.pageTo
})

// Focus methods
const focusByParent = () => {
  const targetPhase = phaseRefs.value[focusedPhaseIndex.value] || phaseRefs.value[0]
  if (targetPhase) {
    targetPhase.focusByParent()
  } else {
    // No phases, focus the column itself (empty state)
    if (document.activeElement === columnRef.value) return
    ignoreNextFocus.value = true
    columnRef.value?.focus()
  }
}

const blurByParent = () => {
  const focusedPhase = phaseRefs.value[focusedPhaseIndex.value]
  if (focusedPhase) {
    focusedPhase.blurByParent()
  }
  columnRef.value?.blur()
}

// Focus event handlers
const handleFocus = () => {
  if (ignoreNextFocus.value) {
    ignoreNextFocus.value = false
    return
  }

  // Column received focus (empty state case)
  // Don't emit 'focused' for columns - parent doesn't need to track
}

const handlePhaseFocused = (index: number) => {
  focusedPhaseIndex.value = index
  scrollPhaseIntoView(index)
}

// Navigation
const navigateDown = () => {
  if (focusedPhaseIndex.value < props.phases.length - 1) {
    uiStore.clearPendingDelete()
    focusedPhaseIndex.value++
    phaseRefs.value[focusedPhaseIndex.value]?.focusByParent()
  }
}

const navigateUp = () => {
  if (focusedPhaseIndex.value > 0) {
    uiStore.clearPendingDelete()
    focusedPhaseIndex.value--
    phaseRefs.value[focusedPhaseIndex.value]?.focusByParent()
  }
}

// Keyboard handling
const handleKeydown = (e: KeyboardEvent) => {
  switch (e.key) {
    case 'j':
      e.preventDefault()
      navigateDown()
      break
    case 'k':
      e.preventDefault()
      navigateUp()
      break
    case 'h':
      e.preventDefault()
      emit('pageNavigation', -1)
      break
    case 'l':
      e.preventDefault()
      const focusedPhase = phaseRefs.value[focusedPhaseIndex.value]
      if (focusedPhase) {
        emit('pageNavigation', +1)
        // After viewport scrolls, focus the child column
        nextTick(() => {
          focusedPhase.focusChildColumn()
        })
      }
      break
    case 'o':
      e.preventDefault()
      openCreateModal()
      break
    case 'd':
      e.preventDefault()
      handleDeletePhase()
      break
  }
}

// Modal management
const openCreateModal = () => {
  showCreateModal.value = true
  // TODO: Implement modal integration in Phase 7
}

// Delete handling
const handleDeletePhase = () => {
  const phaseIndex = focusedPhaseIndex.value
  const phase = props.phases[phaseIndex]
  if (!phase) return

  if (uiStore.pendingDeletePhaseId === phase.id) {
    // Confirm delete
    deletePhase(phase)
    uiStore.clearPendingDelete()
  } else {
    // First press - mark for deletion
    uiStore.setPendingDeletePhase(phase.id)
  }
}

const deletePhase = async (phase: Phase) => {
  try {
    // TODO: Implement deletion (needs trpc import and actual delete logic)
    // This will be completed in Phase 8 cleanup
    console.log('Delete phase:', phase.id)

    // For now, just clear pending delete
    uiStore.clearPendingDelete()
  } catch (error) {
    console.error('Failed to delete phase:', error)
  }
}

// Scroll into view (1/4 to 3/4 viewport)
const scrollPhaseIntoView = async (phaseIndex: number) => {
  await nextTick()

  const container = phaseListRef.value
  if (!container) return

  const phaseElement = phaseRefs.value[phaseIndex]?.$el || phaseRefs.value[phaseIndex]
  if (!phaseElement) return

  const containerRect = container.getBoundingClientRect()
  const phaseRect = phaseElement.getBoundingClientRect()

  const viewportHeight = window.innerHeight
  const quarterMark = viewportHeight * 0.25
  const threeQuarterMark = viewportHeight * 0.75

  const isAboveRange = phaseRect.top < quarterMark
  const isBelowRange = phaseRect.bottom > threeQuarterMark

  if (!isAboveRange && !isBelowRange) return

  let targetScroll = container.scrollTop

  if (isBelowRange) {
    const offset = phaseRect.bottom - threeQuarterMark
    targetScroll += offset
  } else if (isAboveRange) {
    const offset = phaseRect.top - quarterMark
    targetScroll += offset
  }

  const maxScroll = container.scrollHeight - container.clientHeight
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
}

// Keyboard hints
const keyboardHints = ref<Record<string, string>>({
  'j': 'next phase',
  'k': 'prev phase',
  'o': 'create phase',
  'd': 'delete phase',
  'h': 'prev page',
  'l': 'next page'
})

let unregisterHints: (() => void) | null = null

onMounted(() => {
  unregisterHints = uiStore.registerKeyboardHints(keyboardHints)
})

onUnmounted(() => {
  unregisterHints?.()
})

// Expose methods
defineExpose({
  focusByParent,
  blurByParent
})
</script>

<template>
  <div
    ref="columnRef"
    class="phase-column"
    :class="{ 'not-visible': !isVisible }"
    tabindex="0"
    @focus="handleFocus"
    @keydown="handleKeydown"
  >
    <div v-if="phases.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div v-else ref="phaseListRef" class="phase-list">
      <PhaseComponent
        v-for="(phase, index) in phases"
        :key="phase.id"
        :ref="el => { if (el) phaseRefs[index] = el as InstanceType<typeof PhaseComponent> }"
        :phase="phase"
        :is-selected="index === focusedPhaseIndex"
        :column-index="columnIndex"
        :column-depth="columnDepth"
        :page-from="pageFrom"
        :page-to="pageTo"
        @focused="handlePhaseFocused(index)"
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

.phase-column.not-visible {
  opacity: 0.3;
  pointer-events: none;
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
