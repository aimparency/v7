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
  isThisAimSelected?: boolean
  phaseId: string
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0,
  isActive: false,
  isSelected: false,
  isThisAimSelected: false
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
watch(() => props.isThisAimSelected, (isSelected) => {
  if (isSelected && !(isExpanded && props.aim.selectedIncomingIndex) && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
}, { flush: 'post' })

// Scroll on mount if already selected (for cascade restoration)
onMounted(() => {
  if (props.isThisAimSelected && aimContainerRef.value) {
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
        :is-active="isActive && isThisAimSelected"
        :is-selected="isSelected && isThisAimSelected"
        :selected-aim-index="aim.selectedIncomingIndex"
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

  &.moving {
    position: relative;
    outline: 0.15rem solid rgba(0, 122, 204, 0.4);
    outline-offset: -0.15rem;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(
        45deg,
        rgba(0, 122, 204, 0.04) 0px,
        rgba(0, 122, 204, 0.04) 10px,
        transparent 10px,
        transparent 20px
      );
      background-size: 50px 50px;
      animation: moving-stripes 1s linear infinite;
      pointer-events: none;
      border-radius: inherit;
    }
  }
}

@keyframes moving-stripes {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 50px 0;
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