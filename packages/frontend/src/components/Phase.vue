<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { Phase, Hint } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

interface Props {
  phase: Phase
  isSelected?: boolean
  columnIndex: number
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false
})

const emit = defineEmits<{
  requestNextPhase: [enterEditMode: boolean, aimIndex?: number]
  requestPreviousPhase: [enterEditMode: boolean, aimIndex?: number]
  phaseClicked: []
}>()

// Component's own UI state
const isInEditMode = ref(false)
const selectedAimIndex = ref(0)
const expandedAims = ref<Set<string>>(new Set())
const aboutToDelete = ref<string | null>(null)
const aboutToRemove = ref<string | null>(null)

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
  if (!aimsContainerRef.value) return
  
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

// Enter edit mode at specific aim index
const enterEditMode = async (aimIndex?: number) => {
  const aims = phaseAims.value
  if (aims.length === 0) return
  
  isInEditMode.value = true
  
  // Set aim index: -1 means last aim, undefined/0 means first aim
  if (aimIndex === -1) {
    selectedAimIndex.value = aims.length - 1
  } else if (aimIndex !== undefined) {
    selectedAimIndex.value = Math.min(aimIndex, aims.length - 1)
  } else {
    selectedAimIndex.value = 0
  }
  
  updateHints()
  await focusSelectedAim()
}

// Handle focus event - when phase gets focused, focus the appropriate child element
const handleFocus = async () => {
  if (isInEditMode.value) {
    // If in edit mode, focus the selected aim instead
    await focusSelectedAim()
  }
}

// Handle blur event - clear confirmation states when focus is lost
const handleBlur = () => {
  clearConfirmationStates()
  updateHints()
}

// Handle aim click - update selection and enter edit mode
const handleAimClick = async (clickedIndex: number) => {
  selectedAimIndex.value = clickedIndex
  clearConfirmationStates()
  
  if (!isInEditMode.value) {
    isInEditMode.value = true
  }
  
  updateHints()
  await focusSelectedAim()
  
  // Let parent know this phase is now active
  emit('phaseClicked')
}

// Expose methods for external access
defineExpose({
  enterEditMode
})

// Clear confirmation states
const clearConfirmationStates = () => {
  aboutToDelete.value = null
  aboutToRemove.value = null
}

// Update hints based on current mode
const updateHints = () => {
  if (isInEditMode.value) {
    const hints: Hint[] = [
      { key: 'j/k', action: 'navigate aims' },
      { key: 'h/l', action: 'expand/collapse' },
      { key: 'o', action: 'create aim' },
      { key: 'd', action: 'delete aim' },
      { key: 'Esc', action: 'exit edit' }
    ]
    
    // Only show remove option if not in null phase
    if (props.phase.id !== 'null') {
      hints.splice(-1, 0, { key: 'r', action: 'remove aim' })
    }
    
    if (aboutToDelete.value) {
      hints.unshift({ key: 'd', action: 'confirm delete (red)' })
    } else if (aboutToRemove.value) {
      hints.unshift({ key: 'r', action: 'confirm remove (orange)' })
    }
    
    uiStore.setKeyboardHints(hints)
  } else if (props.isSelected) {
    uiStore.setKeyboardHints([
      { key: 'i', action: 'enter phase edit' },
      { key: 'j/k', action: 'navigate phases' },
      { key: 'h/l', action: 'switch columns' }
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
      clearConfirmationStates()
      isInEditMode.value = false
      updateHints() // Update hints when exiting edit mode
      // Focus back to the phase container
      await nextTick()
      phaseElement.value?.focus()
      break
    case 'j':
      event.preventDefault()
      event.stopPropagation()
      clearConfirmationStates()
      if (selectedAimIndex.value < aims.length - 1) {
        selectedAimIndex.value++
        await focusSelectedAim()
      } else {
        // At last aim, request next phase and start at first aim
        emit('requestNextPhase', true, 0)
      }
      updateHints()
      break
    case 'k':
      event.preventDefault()
      event.stopPropagation()
      clearConfirmationStates()
      if (selectedAimIndex.value > 0) {
        selectedAimIndex.value--
        await focusSelectedAim()
      } else {
        // At first aim, request previous phase and start at last aim
        emit('requestPreviousPhase', true, -1)
      }
      updateHints()
      break
    case 'l':
      event.preventDefault()
      clearConfirmationStates()
      if (aims.length > selectedAimIndex.value) {
        const aim = aims[selectedAimIndex.value]
        if (aim.incoming.length > 0) {
          expandedAims.value.add(aim.id)
          event.stopPropagation() // Only stop propagation if we handled the expansion
        }
        // If no expansion happened, let it bubble up for cross-column navigation
      }
      updateHints()
      break
    case 'h':
      event.preventDefault()
      clearConfirmationStates()
      if (aims.length > selectedAimIndex.value) {
        const aim = aims[selectedAimIndex.value]
        if (expandedAims.value.has(aim.id)) {
          expandedAims.value.delete(aim.id)
          event.stopPropagation() // Only stop propagation if we handled the collapse
        }
        // If no collapse happened, let it bubble up for cross-column navigation
      }
      updateHints()
      break
    case 'o':
      event.preventDefault()
      event.stopPropagation()
      clearConfirmationStates()
      // Create aim after current selection (or at index 0 if no aims)
      const afterIndex = aims.length > 0 ? selectedAimIndex.value + 1 : 0
      await createAim(afterIndex)
      updateHints()
      break
    case 'O':
      event.preventDefault()
      event.stopPropagation()
      clearConfirmationStates()
      // Create aim before current selection (or at index 0 if no aims)
      const beforeIndex = aims.length > 0 ? selectedAimIndex.value : 0
      await createAim(beforeIndex)
      updateHints()
      break
    case 'd':
      event.preventDefault()
      event.stopPropagation()
      if (aims.length === 0) break
      
      const currentAim = aims[selectedAimIndex.value]
      if (!currentAim) break
      
      if (aboutToDelete.value === currentAim.id) {
        // Confirm deletion
        try {
          await dataStore.deleteAim(uiStore.projectPath, currentAim.id)
          
          // Adjust selection after deletion
          if (selectedAimIndex.value >= aims.length - 1) {
            selectedAimIndex.value = Math.max(0, aims.length - 2)
          }
          
          // Reload aims
          await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
          
          clearConfirmationStates()
          updateHints()
          await focusSelectedAim()
        } catch (error) {
          console.error('Failed to delete aim:', error)
          clearConfirmationStates()
          updateHints()
        }
      } else {
        // Mark for deletion
        aboutToDelete.value = currentAim.id
        aboutToRemove.value = null
        updateHints()
      }
      break
    case 'r':
      event.preventDefault()
      event.stopPropagation()
      if (aims.length === 0) break
      
      // Don't allow removal from null phase (aims aren't actually in a phase)
      if (props.phase.id === 'null') break
      
      const aimToRemove = aims[selectedAimIndex.value]
      if (!aimToRemove) break
      
      if (aboutToRemove.value === aimToRemove.id) {
        // Confirm removal
        try {
          await dataStore.removeAimFromPhase(uiStore.projectPath, aimToRemove.id, props.phase.id)
          
          // Adjust selection after removal
          if (selectedAimIndex.value >= aims.length - 1) {
            selectedAimIndex.value = Math.max(0, aims.length - 2)
          }
          
          // Reload aims for current phase
          await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
          
          // Also reload null phase in case the removed aim should appear there
          await dataStore.loadPhaseAims(uiStore.projectPath, 'null')
          
          clearConfirmationStates()
          updateHints()
          await focusSelectedAim()
        } catch (error) {
          console.error('Failed to remove aim from phase:', error)
          clearConfirmationStates()
          updateHints()
        }
      } else {
        // Mark for removal
        aboutToRemove.value = aimToRemove.id
        aboutToDelete.value = null
        updateHints()
      }
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
      committedIn: [],
      status: {
        state: 'open',
        comment: '',
        date: Date.now()
      }
    })
    
    // If this is not the Root phase, commit the aim to this phase at the specified position
    if (props.phase.id !== 'null') {
      await dataStore.commitAimToPhase(uiStore.projectPath, result.id, props.phase.id, insertionIndex)
    }
    
    // Update selected aim index to the newly created aim position
    if (insertionIndex !== undefined) {
      selectedAimIndex.value = insertionIndex
    }
    
    // Reload this phase's aims
    await dataStore.loadPhaseAims(uiStore.projectPath, props.phase.id)
    
    // Wait for DOM update then focus the newly created aim
    await nextTick()
    await nextTick() // Double nextTick to ensure aims are rendered
    await focusSelectedAim()
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
    @blur="handleBlur"
    @click="emit('phaseClicked')"
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
        :pending-delete="aboutToDelete === aim.id"
        :pending-remove="aboutToRemove === aim.id"
        @aim-clicked="handleAimClick(index)"
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