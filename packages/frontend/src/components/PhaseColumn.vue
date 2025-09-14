<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Phase } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import PhaseComponent from './Phase.vue'

interface Props {
  phases: Phase[]
  columnType: 'left' | 'right'
  isEmpty?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isEmpty: false
})

const emit = defineEmits<{
  phaseSelected: [phaseIndex: number, phase: Phase]
  requestFocusLeft: []
  requestFocusRight: []
}>()

const selectedIndex = ref(0)
const dataStore = useDataStore()
const uiStore = useUIStore()

// When selection changes in left column, emit event to update right column
watch(() => selectedIndex.value, (newIndex) => {
  if (props.columnType === 'left' && props.phases[newIndex]) {
    emit('phaseSelected', newIndex, props.phases[newIndex])
  }
})

// Focus the selected phase when this column gets focused
const focusSelectedPhase = async () => {
  await nextTick()
  const selectedPhase = document.querySelector(
    `.phase-column.${props.columnType} .phase-container:nth-child(${selectedIndex.value + 1})`
  ) as HTMLElement
  selectedPhase?.focus()
}

// Handle column focus event
const handleFocus = () => {
  // Set keyboard hints for column navigation
  uiStore.setKeyboardHints([
    'j/k navigate phases',
    'h/l switch columns', 
    'i enter phase',
    'o create phase'
  ])
  
  focusSelectedPhase()
}

// Handle phase click - update selection and focus
const handlePhaseClick = async (clickedIndex: number) => {
  selectedIndex.value = clickedIndex
  await focusSelectedPhase()
  
  // If this is left column, update right column
  if (props.columnType === 'left') {
    emit('phaseSelected', clickedIndex, props.phases[clickedIndex])
  }
}

// Handle requests from phases to navigate to next/previous phase
const handleRequestNextPhase = async (enterEditMode: boolean, aimIndex?: number) => {
  if (selectedIndex.value < props.phases.length - 1) {
    selectedIndex.value++
    await nextTick()
    
    if (enterEditMode) {
      // Find the new phase component and enter edit mode
      const newPhaseElement = document.querySelector(
        `.phase-column.${props.columnType} .phase-container:nth-child(${selectedIndex.value + 1})`
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
        `.phase-column.${props.columnType} .phase-container:nth-child(${selectedIndex.value + 1})`
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
      // Move focus to left column (if this is right column)
      if (props.columnType === 'right') {
        // Parent component will handle this
        emit('requestFocusLeft')
      }
      break
    case 'l':
      event.preventDefault()
      // Move focus to right column (if this is left column)
      if (props.columnType === 'left') {
        // Parent component will handle this
        emit('requestFocusRight')
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
    :class="columnType"
    tabindex="0"
    @keydown="handleKeydown"
    @focus="handleFocus"
  >
    <div v-if="isEmpty" class="empty-state">
      No child phases
    </div>
    
    <div v-else class="phase-list">
      <PhaseComponent
        v-for="(phase, index) in phases"
        :key="phase.id"
        :phase="phase"
        :is-selected="index === selectedIndex"
        :column-type="columnType"
        @request-next-phase="handleRequestNextPhase"
        @request-previous-phase="handleRequestPreviousPhase"
        @phase-clicked="handlePhaseClick(index)"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-column {
  flex: 1;
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
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}
</style>