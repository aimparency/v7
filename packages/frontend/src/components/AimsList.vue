<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Aim } from 'shared'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

interface Props {
  aims: Aim[]
  phaseId: string
  columnIndex: number
  isActive: boolean
  isSelected: boolean
  indentationLevel?: number
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0
})

// Exponential decay for indentation: 2rem, 1.2rem, 0.72rem, ...
const indentWidth = computed(() => {
  if (props.indentationLevel === 0) return 0
  const indent = 2 * Math.pow(0.6, props.indentationLevel - 1)
  return indent
})

const emit = defineEmits<{
  'aim-clicked': [index: number]
  'scroll-request': [element: HTMLElement]
}>()

const uiStore = useUIStore()
const aimsListRef = ref<HTMLElement | null>(null)

// Handle scroll requests from child aims
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
  <div ref="aimsListRef" class="aims-list-wrapper">
    <div v-if="indentWidth > 0" class="indent-space" :style="{ width: `${indentWidth}rem` }">
      <div class="indent-line"></div>
    </div>
    <div class="aims-list">
      <div v-if="aims.length === 0" class="empty-hint">
        No aims yet
      </div>
      <AimComponent
        v-for="(aim, index) in aims"
        :key="aim.id"
        :aim="aim"
        :phase-id="phaseId"
        :indentation-level="indentationLevel"
        :is-active="isActive && uiStore.selectedAim?.aimId ? uiStore.selectedAim.aimId === aim.id : (uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.aimIndex === index)"
        :is-selected="isSelected && uiStore.selectedAim?.aimId ? uiStore.selectedAim.aimId === aim.id : (uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.aimIndex === index)"
        :class="{
          'selected-outlined': isActive && (uiStore.selectedAim?.aimId ? uiStore.selectedAim.aimId === aim.id : (uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.aimIndex === index)),
          'selected': isSelected && (uiStore.selectedAim?.aimId ? uiStore.selectedAim.aimId === aim.id : (uiStore.selectedAim?.phaseId === phaseId && uiStore.selectedAim?.aimIndex === index)),
          'pending-delete': uiStore.pendingDeleteAimIndex === index && uiStore.selectedAim?.phaseId === phaseId
        }"
        @scroll-request="handleScrollRequest"
        @aim-clicked="$emit('aim-clicked', index)"
      />
    </div>
  </div>
</template>

<style scoped>
.aims-list-wrapper {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
}

.indent-space {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  .indent-line {
    width: min(0.4rem, 100%);
    height: calc(100% - 1.5rem);
    min-height: 0.4rem;
    margin-top: 0.5rem;
    margin-bottom: 1rem;
    background-color: #eee3;
    border-radius: 0.5rem;
  }
}

.aims-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 0.5rem 0.5rem 0.5rem;
  min-height: 0;

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

.empty-hint {
  font-size: 0.7rem;
  color: #666;
  font-style: italic;
  padding: 0.25rem 0;
}
</style>
