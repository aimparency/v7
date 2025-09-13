<script setup lang="ts">
import { computed } from 'vue'
import type { Phase } from 'shared'
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

const uiStore = useUIStore()

const isFocused = computed(() => {
  return uiStore.focusedColumn === props.columnType
})

const selectedIndex = computed(() => {
  if (props.columnType === 'left') {
    return uiStore.selectedPhaseIndex
  } else {
    return uiStore.selectedRightPhaseIndex
  }
})

const isInEditMode = computed(() => {
  if (props.columnType === 'left') {
    return uiStore.leftColumnInEditMode
  } else {
    return uiStore.rightColumnInEditMode
  }
})
</script>

<template>
  <div 
    class="phase-column" 
    :class="{ 
      focused: isFocused,
      'in-edit-mode': isInEditMode 
    }"
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
        :is-in-edit-mode="isInEditMode && index === selectedIndex"
        :column-type="columnType"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-column {
  flex: 1;
  border-right: 1px solid #444;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  
  &:last-child {
    border-right: none;
  }
  
  &.focused {
    background: #252525;
  }
  
  &.in-edit-mode {
    opacity: 0.7;
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