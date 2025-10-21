<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Aim } from '../stores/data'
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

const emit = defineEmits<{
  'aim-clicked': [aimId: string]
  'scroll-request': [element: HTMLElement]
}>()

const uiStore = useUIStore()
const aimsListRef = ref<HTMLElement | null>(null)

// Handle scroll requests from child aims
const handleScrollRequest = (element: HTMLElement) => {
  // Forward to parent (column) for scrolling
  emit('scroll-request', element)
}
</script>

<template>
  <div ref="aimsListRef" class="aims-list-wrapper">
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
        :is-active="isActive"
        :is-selected="isSelected"
        :class="{
          'selected-outlined': isActive && uiStore.selectedAim?.aimId === aim.id,
          'selected': isSelected && uiStore.selectedAim?.aimId === aim.id,
          'pending-delete': uiStore.pendingDeleteAimId === aim.id
        }"
        @scroll-request="handleScrollRequest"
        @aim-clicked="$emit('aim-clicked', $event)"
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

.aims-list {
  flex: 1;
  min-height: 0;
}

.empty-hint {
  font-size: 0.7rem;
  color: #666;
  font-style: italic;
  padding: 0.25rem 0;
}
</style>
