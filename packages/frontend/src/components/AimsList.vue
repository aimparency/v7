<script setup lang="ts">
import { ref, watch } from 'vue'
import draggable from 'vuedraggable'
import type { Aim } from '../stores/data'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

interface Props {
  aims: Aim[]
  phaseId: string
  columnIndex: number
  isActive: boolean
  isSelected: boolean
  indentationLevel?: number
  selectedAimIndex?: number  // Index of selected aim in this list
  parentAimId?: string
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0,
  selectedAimIndex: undefined,
  parentAimId: undefined
})

const emit = defineEmits<{
  'aim-clicked': [aimId: string]
  'scroll-request': [element: HTMLElement]
}>()

const uiStore = useUIStore()
const dataStore = useDataStore()
const aimsListRef = ref<HTMLElement | null>(null)
const localAims = ref<Aim[]>([...props.aims])

watch(() => props.aims, (newVal) => {
  localAims.value = [...newVal]
})

const handleChange = async (event: any) => {
  if (event.moved) {
    const { newIndex, element } = event.moved
    const aimId = element.id
    
    if (props.parentAimId) {
      await dataStore.reorderSubAim(uiStore.projectPath, props.parentAimId, aimId, newIndex)
    } else {
      await dataStore.reorderPhaseAim(uiStore.projectPath, props.phaseId, aimId, newIndex)
    }
  }
}

// Handle scroll requests from child aims
const handleScrollRequest = (element: HTMLElement) => {
  // Forward to parent (column) for scrolling
  emit('scroll-request', element)
}
</script>

<template>
  <div ref="aimsListRef" class="aims-list-wrapper">
    <draggable
      v-model="localAims"
      item-key="id"
      group="aims"
      @change="handleChange"
      class="aims-list"
      handle=".aim-content" 
    >
      <template #item="{ element: aim, index }">
        <AimComponent
          :key="aim.id"
          :aim="aim"
          :phase-id="phaseId"
          :column-index="columnIndex"
          :indentation-level="indentationLevel"
          :is-active="isActive"
          :is-selected="isSelected"
          :is-this-aim-selected="selectedAimIndex === index"
          :class="{
            'selected-outlined': isActive && selectedAimIndex === index,
            'selected': isSelected && selectedAimIndex === index,
            'pending-delete': uiStore.pendingDeleteAimId === aim.id,
            'moving': uiStore.movingAimId === aim.id
          }"
          @scroll-request="handleScrollRequest"
          @aim-clicked="$emit('aim-clicked', $event)"
        />
      </template>
      <template #footer>
         <div v-if="aims.length === 0" class="empty-hint">
          No aims yet
        </div>
      </template>
    </draggable>
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
