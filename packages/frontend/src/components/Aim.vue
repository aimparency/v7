<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from 'vue'
import type { Aim } from '../stores/data'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimsList from './AimsList.vue'

defineOptions({ inheritAttrs: false })

interface Props {
  aim: Aim
  indentationLevel?: number
  isActive?: boolean
  isSelected?: boolean
  phaseId: string
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0,
  isActive: false,
  isSelected: false
})

const emit = defineEmits<{
  'aim-clicked': [aimId: string]
  'scroll-request': [element: HTMLElement]
}>()

const attrs = useAttrs()
const aimContainerRef = ref<HTMLElement | null>(null)
const dataStore = useDataStore()

const hasIncomingAims = computed(() => props.aim.incoming?.length > 0)
const isExpanded = computed(() => props.aim.expanded || false)

// Check if this specific aim is selected (by aimId)
const uiStore = useUIStore()
const isThisAimSelected = computed(() => {
  return uiStore.selectedAim?.aimId === props.aim.id
})

// Get incoming aims from the data store
const incomingAims = computed(() => {
  if (!hasIncomingAims.value) return []
  return props.aim.incoming
    .map(aimId => dataStore.aims[aimId])
    .filter(Boolean)
})

const statusColor = computed(() => ({
  'open': '#87f',
  'done': '#00ff00',
  'cancelled': '#ff0000',
  'partially': '#ffff00',
  'failed': '#ff6666'
}[props.aim.status.state] ?? '#888'))

// Scroll into view when this aim becomes selected
watch(() => isThisAimSelected.value, (isSelected) => {
  if (isSelected && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
}, { flush: 'post' })

// Scroll on mount if already selected (for cascade restoration)
onMounted(() => {
  if (isThisAimSelected.value && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
})
</script>

<template>
  <div
    ref="aimContainerRef"
    class="aim-item"
    :class="[attrs.class, { expanded: isExpanded }]"
    @click.stop="$emit('aim-clicked', aim.id)"
  >
    <!-- Aim content -->
    <div class="aim-content">
      <div class="aim-text" :class="{ 'untitled': !aim.text }">
        {{ aim.text || '(untitled)' }}
      </div>
      <div class="aim-meta">
        <div
          class="aim-status"
          :style="{ color: statusColor }"
        >
          {{ aim.status.state }}
        </div>
        <div v-if="aim.status.comment" class="aim-comment">
          {{ aim.status.comment }}
        </div>
      </div>
    </div>

    <!-- Expanded incoming aims (recursive) -->
    <div v-if="isExpanded" class="incoming-aims">
      <div class="indent-space" :style="{ width: `${2.3 * Math.pow(0.8, indentationLevel)}rem` }">
        <div class="indent-line"></div>
      </div>
      <AimsList
        :aims="incomingAims"
        :phase-id="phaseId"
        :column-index="0"
        :indentation-level="indentationLevel + 1"
        :is-active="true"
        :is-selected="true"
        @scroll-request="$emit('scroll-request', $event)"
        @aim-clicked="$emit('aim-clicked', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.aim-item {
  display: flex;
  flex-direction: column;
  padding: 0.25rem 0;
  cursor: pointer;

  &.selected-outlined {
    outline: 0.15rem solid #007acc;
    outline-offset: -0.15rem;
    margin-left: -0.5rem;
    margin-right: -0.5rem;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }

  &.pending-delete {
    background-color: rgba(255, 0, 0, 0.2);
  }

  &.pending-remove {
    background-color: rgba(255, 165, 0, 0.2);
  }
}

.aim-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  
  .aim-text {
    color: #e0e0e0;
    line-height: 1.4;

    &.untitled {
      color: #888;
      font-style: italic;
    }
  }
  
  .aim-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8rem;
    
    .aim-status {
      text-transform: uppercase;
      font-weight: bold;
    }
    
    .aim-comment {
      color: #888;
      font-style: italic;
    }
  }
}

.incoming-aims {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;

  .indent-space {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    .indent-line {
      width: max(1px, 20%);
      height: calc(100% - 1.5rem);
      min-height: 0.4rem;
      margin-top: 0.5rem;
      margin-bottom: 1rem;
      background-color: #eee3;
      border-radius: 0.5rem;
    }
  }

  .aims-list-wrapper {
    flex: 1;
    min-width: 0;
  }
}
</style>