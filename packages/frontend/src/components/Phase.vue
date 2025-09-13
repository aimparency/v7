<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { Phase } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

interface Props {
  phase: Phase
  isSelected?: boolean
  columnType: 'left' | 'right'
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false
})

// Component's own UI state
const isInEditMode = ref(false)
const selectedAimIndex = ref(0)
const expandedAims = ref<Set<string>>(new Set())

const dataStore = useDataStore()
const uiStore = useUIStore()

const phaseAims = computed(() => {
  return dataStore.getPhaseAims(props.phase.id)
})

// DOM element reference for focus
const phaseElement = ref<HTMLElement>()
const aimsContainerRef = ref<HTMLElement>()

// Focus and scroll to the selected aim
const focusSelectedAim = async () => {
  if (!isInEditMode.value || !aimsContainerRef.value) return
  
  await nextTick()
  const aims = phaseAims.value
  if (aims.length === 0 || selectedAimIndex.value >= aims.length) return
  
  // Find the aim element by index
  const aimElements = aimsContainerRef.value.querySelectorAll('.aim-item.focusable')
  const targetAim = aimElements[selectedAimIndex.value] as HTMLElement
  
  if (targetAim) {
    targetAim.focus()
    targetAim.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

// Handle focus event - when phase gets focused, focus the appropriate child element
const handleFocus = async () => {
  if (isInEditMode.value) {
    // If in edit mode, focus the selected aim instead
    await focusSelectedAim()
  }
}

// Update hints based on current mode
const updateHints = () => {
  if (isInEditMode.value) {
    uiStore.setKeyboardHints([
      'j/k navigate aims',
      'h/l expand/collapse',
      'o create aim',
      'Esc exit edit'
    ])
  } else if (props.isSelected) {
    uiStore.setKeyboardHints([
      'i enter phase edit',
      'j/k navigate phases',
      'h/l switch columns'
    ])
  }
}

// Keyboard navigation
const handleKeydown = async (event: KeyboardEvent) => {
  if (!isInEditMode.value) {
    // Column navigation mode
    if (event.key === 'i') {
      event.preventDefault()
      isInEditMode.value = true
      selectedAimIndex.value = 0
      updateHints() // Update hints when entering edit mode
      await focusSelectedAim() // Focus and scroll to first aim
    }
    return
  }
  
  // Phase edit mode
  const aims = phaseAims.value
  
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      isInEditMode.value = false
      updateHints() // Update hints when exiting edit mode
      break
    case 'j':
      event.preventDefault()
      event.stopPropagation()
      if (selectedAimIndex.value < aims.length - 1) {
        selectedAimIndex.value++
        await focusSelectedAim()
      }
      break
    case 'k':
      event.preventDefault()
      event.stopPropagation()
      if (selectedAimIndex.value > 0) {
        selectedAimIndex.value--
        await focusSelectedAim()
      }
      break
    case 'l':
      event.preventDefault()
      if (aims.length > selectedAimIndex.value) {
        const aim = aims[selectedAimIndex.value]
        if (aim.incoming.length > 0) {
          expandedAims.value.add(aim.id)
          event.stopPropagation() // Only stop propagation if we handled the expansion
        }
        // If no expansion happened, let it bubble up for cross-column navigation
      }
      break
    case 'h':
      event.preventDefault()
      if (aims.length > selectedAimIndex.value) {
        const aim = aims[selectedAimIndex.value]
        if (expandedAims.value.has(aim.id)) {
          expandedAims.value.delete(aim.id)
          event.stopPropagation() // Only stop propagation if we handled the collapse
        }
        // If no collapse happened, let it bubble up for cross-column navigation
      }
      break
    case 'o':
      event.preventDefault()
      event.stopPropagation()
      // Create aim after current selection (or at index 0 if no aims)
      const afterIndex = aims.length > 0 ? selectedAimIndex.value + 1 : 0
      await createAim(afterIndex)
      break
    case 'O':
      event.preventDefault()
      event.stopPropagation()
      // Create aim before current selection (or at index 0 if no aims)
      const beforeIndex = aims.length > 0 ? selectedAimIndex.value : 0
      await createAim(beforeIndex)
      break
  }
}

// Create new aim at specified position
const createAim = async (insertionIndex?: number) => {
  const aimText = prompt('Enter aim text:')
  if (!aimText?.trim()) return
  
  try {
    const uiStore = useUIStore()
    
    // Create the aim first
    const result = await dataStore.createAim(uiStore.projectPath, {
      text: aimText.trim(),
      incoming: [],
      outgoing: [],
      status: {
        state: 'open',
        comment: '',
        date: Date.now()
      }
    })
    
    // If this is not the Root phase, commit the aim to this phase at the specified position
    if (props.phase.id !== 'null') {
      await dataStore.commitAimToPhase(uiStore.projectPath, result.id, props.phase.id, insertionIndex)
      
      // Update selected aim index to the newly created aim
      if (insertionIndex !== undefined) {
        selectedAimIndex.value = insertionIndex
      }
    }
    
    // Reload this phase's aims
    await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
  } catch (error) {
    console.error('Failed to create aim:', error)
  }
}

// Load aims when this phase is selected
watch(() => props.isSelected, async (newVal) => {
  if (newVal) {
    // Focus this element when selected
    await nextTick()
    phaseElement.value?.focus()
    
    // Update hints for selected phase
    updateHints()
  }
})

// Load aims on mount - always load aims immediately
onMounted(async () => {
  await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
  
  // Update hints if this phase is initially selected
  if (props.isSelected) {
    updateHints()
  }
})
</script>

<template>
  <div 
    ref="phaseElement"
    class="phase-container focusable"
    tabindex="0"
    @keydown="handleKeydown"
    @focus="handleFocus"
  >
    <!-- Phase Header -->
    <div class="phase-header">
      <div class="phase-name">{{ phase.name }}</div>
    </div>
    
    <!-- Aims List -->
    <div ref="aimsContainerRef" class="aims-container">
      <AimComponent
        v-for="(aim, index) in phaseAims"
        :key="aim.id"
        :aim="aim"
        :is-expanded="expandedAims.has(aim.id)"
        :indentation-level="0"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-container {
  padding: 0.5rem;
  margin-bottom: 0.25rem;
  border-radius: 0.1875rem;
  cursor: pointer;
}

.phase-header {
  .phase-name {
    font-weight: bold;
  }
}

.aims-container {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>