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

// Exponential decay for indentation: 5rem, 3rem, 1.8rem, ...
const indentWidth = computed(() => {
  if (props.indentationLevel === 0) return 0
  const indent = 5 * Math.pow(0.6, props.indentationLevel - 1)
  return indent
})

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
      <div v-if="indentWidth > 0" class="indent-space" :style="{ width: `${indentWidth}rem` }">
        <div class="indent-line"></div>
      </div>
      <div class="incoming-content">
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
  </div>
</template>

<style scoped>
.aim-item {
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  margin-bottom: 0.25rem;
  cursor: pointer;

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

  .indent-space {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;

    .indent-line {
      width: 1px;
      height: 100%;
      min-height: 0.4rem;
      background-color: #eee3;
      border-radius: 0.5rem;
    }
  }

  .incoming-content {
    flex: 1;
    min-width: 0;
  }
}
</style>