<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Phase, Hint } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import PhaseComponent from './Phase.vue'

interface Props {
  phases: Phase[]
  columnIndex: number
  isEmpty?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isEmpty: false
})

const emit = defineEmits<{
  phaseSelected: [{ phaseIndex: number, phase: Phase }]
  requestNavigateLeft: []
  requestNavigateRight: []
}>()

const selectedIndex = ref(0)
const dataStore = useDataStore()
const uiStore = useUIStore()

// When selection changes, emit event to update next column
watch(() => selectedIndex.value, (newIndex) => {
  if (props.phases[newIndex]) {
    emit('phaseSelected', { phaseIndex: newIndex, phase: props.phases[newIndex] })
  }
})

// Focus the selected phase when this column gets focused
const focusSelectedPhase = async () => {
  await nextTick()
  
  if (props.isEmpty) {
    // Focus the empty state div
    const emptyState = document.querySelector(
      `.phase-column[data-column-index="${props.columnIndex}"] .empty-state`
    ) as HTMLElement
    emptyState?.focus()
  } else {
    // Focus the selected phase
    const selectedPhase = document.querySelector(
      `.phase-column[data-column-index="${props.columnIndex}"] .phase-container:nth-child(${selectedIndex.value + 1})`
    ) as HTMLElement
    selectedPhase?.focus()
  }
}

// Handle column focus event
const handleFocus = () => {
  // Set keyboard hints for column navigation
  const hints = [
    { key: 'h/l', action: 'switch columns' },
    { key: 'o', action: 'create phase' }
  ]
  
  // Add phase-specific hints only if phases exist
  if (!props.isEmpty) {
    hints.unshift(
      { key: 'j/k', action: 'navigate phases' },
      { key: 'i', action: 'enter phase' }
    )
  }
  
  uiStore.setKeyboardHints(hints)
  focusSelectedPhase()
}

// Handle phase click - update selection and focus
const handlePhaseClick = async (clickedIndex: number) => {
  selectedIndex.value = clickedIndex
  await focusSelectedPhase()
  
  // Always emit phase selection for any column
  emit('phaseSelected', { phaseIndex: clickedIndex, phase: props.phases[clickedIndex] })
}

// Handle requests from phases to navigate to next/previous phase
const handleRequestNextPhase = async (enterEditMode: boolean, aimIndex?: number) => {
  if (selectedIndex.value < props.phases.length - 1) {
    selectedIndex.value++
    await nextTick()
    
    if (enterEditMode) {
      // Find the new phase component and enter edit mode
      const newPhaseElement = document.querySelector(
        `.phase-column[data-column-index="${props.columnIndex}"] .phase-container:nth-child(${selectedIndex.value + 1})`
      ) as HTMLElement
      
      if (newPhaseElement) {
        // Get Vue component instance - for now focus and simulate 'i' press
        newPhaseElement.focus()
        // Simulate entering edit mode - this is a bit hacky, but works
        await nextTick()
        newPhaseElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }))
      }
    } else {
      focusSelectedPhase()
    }
  }
}

const handleRequestPreviousPhase = async (enterEditMode: boolean, aimIndex?: number) => {
  if (selectedIndex.value > 0) {
    selectedIndex.value--
    await nextTick()
    
    if (enterEditMode) {
      // Find the new phase component and enter edit mode
      const newPhaseElement = document.querySelector(
        `.phase-column[data-column-index="${props.columnIndex}"] .phase-container:nth-child(${selectedIndex.value + 1})`
      ) as HTMLElement
      
      if (newPhaseElement) {
        // Get Vue component instance - for now focus and simulate 'i' press
        newPhaseElement.focus()
        // Simulate entering edit mode - this is a bit hacky, but works
        await nextTick()
        newPhaseElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }))
      }
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
      event.preventDefault()
      // Navigate to previous column
      emit('requestNavigateLeft')
      break
    case 'l':
      event.preventDefault()
      // Navigate to next column (if current phase exists)
      const currentPhase = props.phases[selectedIndex.value]
      if (currentPhase) {
        emit('requestNavigateRight')
      }
      break
    case 'o':
    case 'O':
      event.preventDefault()
      // Open phase creation modal
      uiStore.openPhaseModal()
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
    <div v-if="isEmpty" class="empty-state" tabindex="0">
      No sub phases
    </div>
    
    <div v-else class="phase-list">
      <PhaseComponent
        v-for="(phase, index) in phases"
        :key="phase.id"
        :phase="phase"
        :is-selected="index === selectedIndex"
        :column-index="columnIndex"
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
  border-right: 0.0625rem solid #444;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  &:last-child {
    border-right: none;
  }
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