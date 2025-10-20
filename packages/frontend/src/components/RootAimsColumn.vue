<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

const dataStore = useDataStore()
const uiStore = useUIStore()

const aimsListRef = ref<HTMLElement | null>(null)

const isSelected = computed(() => uiStore.selectedColumn === -1)
const isActive = computed(() => uiStore.selectedColumn === -1)

// Load uncommitted aims
const rootAims = computed(() => {
  return dataStore.getAimsForPhase('null') || []
})

// Handle scroll requests from child components
const handleScrollRequest = (element: HTMLElement) => {
  if (!aimsListRef.value) return

  const container = aimsListRef.value
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  // Calculate 1/4 to 3/4 range
  const minY = containerRect.top + containerRect.height * 0.25
  const maxY = containerRect.top + containerRect.height * 0.75

  // Check if element is outside the range
  const isAboveRange = elementRect.top < minY
  const isBelowRange = elementRect.bottom > maxY

  if (!isAboveRange && !isBelowRange) return

  // Calculate target scroll position
  let targetScroll = container.scrollTop

  if (isBelowRange) {
    const offset = elementRect.bottom - maxY
    targetScroll += offset
  } else if (isAboveRange) {
    const offset = elementRect.top - minY
    targetScroll += offset
  }

  // Clamp to valid scroll range
  const maxScroll = container.scrollHeight - container.clientHeight
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
}
</script>

<template>
  <div class="root-aims-column" :class="{ 'selected-outlined': isActive, 'selected': isSelected }">
    <div v-if="rootAims.length === 0" class="empty-state">
      No aims yet, create one with o
    </div>

    <template v-else>
      <div class=info >free floating aims</div>
      <div ref="aimsListRef" class="aims-list">
        <AimComponent
          v-for="(aim, index) in rootAims"
          :key="aim.id"
          :aim="aim"
          :is-active="isActive && uiStore.selectedAim?.phaseId === 'null' && uiStore.selectedAim?.aimIndex === index"
          :class="{
            'selected-outlined': isActive && uiStore.selectedAim?.phaseId === 'null' && uiStore.selectedAim?.aimIndex === index,
            'selected': isSelected && uiStore.selectedAim?.phaseId === 'null' && uiStore.selectedAim?.aimIndex === index,
            'pending-delete': uiStore.pendingDeleteAimIndex === index && uiStore.selectedAim?.phaseId === 'null'
          }"
          @scroll-request="handleScrollRequest"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.root-aims-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.root-aims-column.selected {
  outline: 2px solid #888;
}

.root-aims-column.selected-outlined {
  outline: 2px solid #007acc;
}

.aims-list {
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

.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}

.info {
  font-size: 0.8rem; 
  color: #fff4; 
  text-align: center;
  margin-top: 0.5rem; 
}
</style>
