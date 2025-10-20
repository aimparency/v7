<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from 'vue'
import type { Aim } from 'shared'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
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
  'aim-clicked': []
  'scroll-request': [element: HTMLElement]
}>()

const attrs = useAttrs()
const aimContainerRef = ref<HTMLElement | null>(null)
const uiStore = useUIStore()
const dataStore = useDataStore()

const hasIncomingAims = computed(() => props.aim.incoming?.length > 0)
const isExpanded = computed(() => uiStore.expandedAims.has(props.aim.id))

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

// Exponential decay for indentation: 2rem, 1rem, 0.5rem, 0.25rem, ...
const indentStyle = computed(() => {
  if (props.indentationLevel === 0) return {}
  const indent = 2 * Math.pow(0.5, props.indentationLevel - 1)
  return { marginLeft: `${indent}rem` }
})

// Scroll into view when selected (active or not)
watch(() => props.isActive || props.isSelected, (shouldScroll) => {
  if (shouldScroll && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
}, { flush: 'post' })

// Scroll on mount if already selected (for cascade restoration)
onMounted(() => {
  if ((props.isActive || props.isSelected) && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
})
</script>

<template>
  <div
    ref="aimContainerRef"
    class="aim-item"
    :class="[attrs.class, { expanded: isExpanded }]"
    @click.stop="$emit('aim-clicked')"
  >
    <!-- Aim content -->
    <div class="aim-content">
      <div class="aim-text">{{ aim.text }}</div>
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
    <div v-if="isExpanded" class="incoming-aims" :style="indentStyle">
      <AimsList
        :aims="incomingAims"
        :phase-id="phaseId"
        :column-index="0"
        :indentation-level="indentationLevel + 1"
        :is-active="isActive"
        :is-selected="isSelected"
        @scroll-request="$emit('scroll-request', $event)"
        @aim-clicked="$emit('aim-clicked')"
      />
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
  .incoming-placeholder {
    color: #666;
    font-style: italic;
    font-size: 0.9rem;
    padding: 0.5rem 0 0.5rem 2rem;
  }
}
</style>