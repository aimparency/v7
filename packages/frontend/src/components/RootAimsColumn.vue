<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import type { Aim, Hint } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

const emit = defineEmits<{
  requestNavigateRight: []
}>()

const selectedIndex = ref(0)
const dataStore = useDataStore()
const uiStore = useUIStore()

// Load uncommitted aims
const rootAims = computed(() => {
  return dataStore.getPhaseAims('null') || []
})

// Focus the selected aim when this column gets focused
const focusSelectedAim = async () => {
  await nextTick()

  if (rootAims.value.length === 0) {
    // Focus the empty state div
    const emptyState = document.querySelector('.root-aims-column .empty-state') as HTMLElement
    emptyState?.focus()
  } else {
    // Focus the selected aim
    const selectedAim = document.querySelector(
      `.root-aims-column .aim-container:nth-child(${selectedIndex.value + 1})`
    ) as HTMLElement
    selectedAim?.focus()
  }
}

// Handle column focus event
const handleFocus = () => {
  uiStore.setFocusedColumn(0)

  // The first PhaseColumn (column 1) is always available for navigation
  uiStore.setRightmostColumn(1)

  // Set keyboard hints for root aims navigation
  const hints = [
    { key: 'l', action: 'to phases column' },
    { key: 'o', action: 'create aim' }
  ]

  // Add aim-specific hints only if aims exist
  if (rootAims.value.length > 0) {
    hints.unshift(
      { key: 'j/k', action: 'navigate aims' },
      { key: 'i', action: 'edit aim' }
    )
  }

  uiStore.setKeyboardHints(hints)
  focusSelectedAim()
}

// Handle aim click - update selection and focus
const handleAimClick = async (clickedIndex: number) => {
  selectedIndex.value = clickedIndex
  await focusSelectedAim()
}

// Handle aim navigation within column
const handleKeydown = async (event: KeyboardEvent) => {
  switch (event.key) {
    case 'j':
      event.preventDefault()
      if (selectedIndex.value < rootAims.value.length - 1) {
        selectedIndex.value++
      }
      break
    case 'k':
      event.preventDefault()
      if (selectedIndex.value > 0) {
        selectedIndex.value--
      }
      break
    case 'l':
      event.preventDefault()
      // Navigate to phases column
      emit('requestNavigateRight')
      break
    case 'o':
    case 'O':
      event.preventDefault()
      // Open aim creation modal for root aims
      uiStore.openAimModal('null', rootAims.value.length)
      break
    case 'i':
      event.preventDefault()
      // Enter aim edit mode (TODO: implement aim editing)
      if (rootAims.value.length > 0) {
        console.log('Edit aim:', rootAims.value[selectedIndex.value])
      }
      break
  }
}

// Load root aims on mount
onMounted(async () => {
  if (uiStore.projectPath) {
    await dataStore.loadPhaseAims(uiStore.projectPath, 'null')
  }
})

// Expose methods for cross-column navigation
defineExpose({
  focusSelectedAim
})
</script>

<template>
  <div
    class="root-aims-column focusable"
    tabindex="0"
    @keydown="handleKeydown"
    @focus="handleFocus"
  >
    <div v-if="rootAims.length === 0" class="empty-state">
      No aims yet, create one with o
    </div>

    <div v-else class="aims-list">
      <AimComponent
        v-for="(aim, index) in rootAims"
        :key="aim.id"
        :aim="aim"
        :class="{ selected: index === selectedIndex }"
        @aim-clicked="handleAimClick(index)"
      />
    </div>
  </div>
</template>

<style scoped>
.root-aims-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Width is now controlled by parent App.vue absolute positioning */
}


.aims-list {
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

.aim-container {
  &.selected .aim-item {
    background: #333;
    border-left: 3px solid #007acc;
  }
}
</style>