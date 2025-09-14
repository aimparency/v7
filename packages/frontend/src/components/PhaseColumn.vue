<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import type { Phase, Hint } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import PhaseComponent from './Phase.vue'

interface Props {
  phases: Phase[]
  columnIndex: number
  columnDepth?: number
  parentPhase?: Phase | null
}

const props = withDefaults(defineProps<Props>(), {
  columnDepth: 1,
  parentPhase: null
})

const emit = defineEmits<{
  requestNavigateLeft: []
  requestNavigateRight: []
}>()

const selectedIndex = ref(0)
const dataStore = useDataStore()
const uiStore = useUIStore()
const phaseRefs = ref<InstanceType<typeof PhaseComponent>[]>([])

// Selection changes are now handled internally by Phase components via teleport

// Focus the selected phase when this column gets focused
const focusSelectedPhase = async () => {
  console.log(`PhaseColumn ${props.columnIndex}: focusSelectedPhase called, phases=${props.phases.length}`)
  await nextTick()

  if (props.phases.length === 0) {
    // Focus the empty state div
    const emptyState = document.querySelector(
      `.phase-column[data-column-index="${props.columnIndex}"] .empty-state`
    ) as HTMLElement
    console.log(`PhaseColumn ${props.columnIndex}: Focusing empty state, found:`, !!emptyState)
    emptyState?.focus()
  } else {
    // Focus the selected phase
    const selectedPhase = document.querySelector(
      `.phase-column[data-column-index="${props.columnIndex}"] .phase-container:nth-child(${selectedIndex.value + 1})`
    ) as HTMLElement
    console.log(`PhaseColumn ${props.columnIndex}: Focusing selected phase, found:`, !!selectedPhase)
    selectedPhase?.focus()
  }
}

// Set rightmost when column is mounted/rendered
onMounted(() => {
  console.log(`PhaseColumn ${props.columnIndex}: Mounted, phases=${props.phases.length}`)

  if (props.phases.length === 0) {
    // If I am empty, I am the definitive rightmost column
    console.log(`PhaseColumn ${props.columnIndex}: Empty, setting rightmost=${props.columnIndex}`)
    uiStore.setRightmostColumn(props.columnIndex)
  } else {
    // If I have phases, ensure rightmost is at least my potential child column index
    // But don't override if an empty column has already set a definitive rightmost
    const minRightmost = props.columnIndex + 1
    console.log(`PhaseColumn ${props.columnIndex}: Has phases, setting min rightmost=${minRightmost}`)
    uiStore.setMinRightmost(minRightmost)
  }
})

// Handle column focus event
const handleFocus = () => {
  console.log(`PhaseColumn ${props.columnIndex}: Got focus, phases=${props.phases.length}`)
  uiStore.setFocusedColumn(props.columnIndex)

  // Set keyboard hints for column navigation
  const hints = [
    { key: 'h', action: 'back to parent' },
    { key: 'o', action: 'create phase' }
  ]

  // Add phase-specific hints only if phases exist
  if (props.phases.length > 0) {
    hints.unshift(
      { key: 'j/k', action: 'navigate phases' },
      { key: 'i', action: 'enter phase' },
      { key: 'l', action: 'to child phases' }
    )
  }

  uiStore.setKeyboardHints(hints)
  focusSelectedPhase()
}

// Handle empty state focus - similar to column focus but specific hints
const handleEmptyStateFocus = () => {
  console.log(`PhaseColumn ${props.columnIndex}: Empty state got focus`)
  uiStore.setFocusedColumn(props.columnIndex)

  const hints = [
    { key: 'h', action: 'back to parent' },
    { key: 'o/Enter', action: 'create phase' }
  ]

  uiStore.setKeyboardHints(hints)
}

// Handle empty state keydown - add Enter key for phase creation
const handleEmptyStateKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'o':
    case 'O':
    case 'Enter':
      event.preventDefault()
      // Open phase creation modal for this column
      uiStore.openPhaseModal(props.columnIndex, props.parentPhase)
      break
    case 'h':
      // Let this bubble up to global handler for navigation
      break
  }
}

// Handle phase click - update selection and focus
const handlePhaseClick = async (clickedIndex: number) => {
  selectedIndex.value = clickedIndex
  await focusSelectedPhase()
}

// Handle requests from phases to navigate to next/previous phase
const handleRequestNextPhase = async (enterEditMode: boolean, aimIndex?: number) => {
  if (selectedIndex.value < props.phases.length - 1) {
    selectedIndex.value++
    await nextTick()

    const targetPhase = phaseRefs.value[selectedIndex.value]
    if (enterEditMode && targetPhase) {
      await targetPhase.enterEditMode(aimIndex)
    } else {
      focusSelectedPhase()
    }
  }
}

const handleRequestPreviousPhase = async (enterEditMode: boolean, aimIndex?: number) => {
  if (selectedIndex.value > 0) {
    selectedIndex.value--
    await nextTick()

    const targetPhase = phaseRefs.value[selectedIndex.value]
    if (enterEditMode && targetPhase) {
      await targetPhase.enterEditMode(aimIndex)
    } else {
      focusSelectedPhase()
    }
  }
}

// Expose methods for cross-column navigation
defineExpose({
  focusSelectedPhase
})

// Handle phase navigation within column
const handleKeydown = async (event: KeyboardEvent) => {
  switch (event.key) {
    case 'j':
      event.preventDefault()
      if (selectedIndex.value < props.phases.length - 1) {
        selectedIndex.value++
      }
      break
    case 'k':
      event.preventDefault()
      if (selectedIndex.value > 0) {
        selectedIndex.value--
      }
      break
    case 'h':
      // Don't prevent default - let this bubble up to global handler
      break
    case 'l':
      event.preventDefault()
      // Try to focus child column if it exists (teleported column)
      const childColumnIndex = props.columnIndex + 1
      const childColumn = document.querySelector(`[data-column-index="${childColumnIndex}"]`) as HTMLElement
      if (childColumn) {
        console.log(`PhaseColumn ${props.columnIndex}: Focusing child column ${childColumnIndex}`)
        childColumn.focus()
        // Also update the focused column in store
        uiStore.setFocusedColumn(childColumnIndex)
      } else {
        console.log(`PhaseColumn ${props.columnIndex}: No child column found at index ${childColumnIndex}`)
      }
      break
    case 'o':
    case 'O':
      event.preventDefault()
      // Open phase creation modal with the parent phase
      uiStore.openPhaseModal(props.columnIndex, props.parentPhase)
      break
  }
}
</script>

<template>
  <div 
    class="phase-column focusable"
    :data-column-index="columnIndex"
    tabindex="0"
    @keydown="handleKeydown"
    @focus="handleFocus"
  >
    <div v-if="phases.length === 0" class="empty-state" tabindex="0" @focus="handleEmptyStateFocus" @keydown="handleEmptyStateKeydown">
      No sub phases, create one with o
    </div>
    
    <div v-else class="phase-list">
      <PhaseComponent
        v-for="(phase, index) in phases"
        :key="phase.id"
        ref="phaseRefs"
        :phase="phase"
        :is-selected="index === selectedIndex"
        :column-index="columnIndex"
        :column-depth="columnDepth"
        @request-next-phase="handleRequestNextPhase"
        @request-previous-phase="handleRequestPreviousPhase"
        @phase-clicked="handlePhaseClick(index)"
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

.phase-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 6px;
  }
  
  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 3px;
    
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