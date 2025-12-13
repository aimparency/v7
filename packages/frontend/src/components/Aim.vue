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
  columnIndex: number
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
const uiStore = useUIStore()

const hasIncomingAims = computed(() => props.aim.supportingConnections && props.aim.supportingConnections.length > 0)
const isExpanded = computed(() => props.aim.expanded || false)

const subAimCount = computed(() => {
  const count = props.aim.supportingConnections?.length || 0
  return count > 9 ? 'N' : count.toString()
})

// Get incoming aims from the data store
const incomingAims = computed(() => {
  if (!hasIncomingAims.value || !props.aim.supportingConnections) return []
  return props.aim.supportingConnections
    .map(conn => dataStore.aims[conn.aimId])
    .filter((a): a is Aim => !!a)
})

const statusColor = computed(() => {
  const colorMap: Record<string, string> = {
    'open': 'var(--status-open)',
    'done': 'var(--status-done)',
    'cancelled': 'var(--status-cancelled)',
    'partially': 'var(--status-partially)',
    'failed': 'var(--status-failed)'
  }
  return colorMap[props.aim.status.state] ?? '#888'
})

// Scroll into view when this aim becomes selected or active
watch(() => [props.isThisAimSelected, props.isActive], ([isSelected, isActive]) => {
  const hasSelectedChild = isExpanded.value && props.aim.selectedIncomingIndex !== undefined
  if (isSelected && isActive && !hasSelectedChild && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
}, { flush: 'post' })

// Ensure sub-aims are loaded when expanded
watch(isExpanded, (newVal) => {
  if (newVal && props.aim.supportingConnections && props.aim.supportingConnections.length > 0) {
    dataStore.loadAims(uiStore.projectPath, props.aim.supportingConnections.map(c => c.aimId))
  }
}, { immediate: true })

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
      <div class="aim-title-row">
        <div class="aim-text" :class="{ 'untitled': !aim.text }">
          {{ aim.text || '(untitled)' }}
        </div>
        <div v-if="hasIncomingAims" class="sub-aim-count-bubble">
          {{ subAimCount }}
        </div>
      </div>
      
      <div v-if="isExpanded && aim.description" class="aim-description">
        {{ aim.description }}
      </div>

      <div v-if="isExpanded && aim.tags && aim.tags.length > 0" class="aim-tags">
        <span v-for="tag in aim.tags" :key="tag" class="tag">#{{ tag }}</span>
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
        :parent-aim-id="aim.id"
        :column-index="columnIndex"
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

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: repeating-linear-gradient(
        45deg,
        rgba(0, 122, 204, 0.2) 0px,
        rgba(0, 122, 204, 0.2) 10px,
        transparent 10px,
        transparent 20px
      );
      background-size: 28.28px 28.28px;
      animation: moving-stripes 1s linear infinite;
      pointer-events: none;
      border-radius: inherit;
      z-index: 1;
    }
  }
}

@keyframes moving-stripes {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 28.28px 0;
  }
}

.aim-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  .aim-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .aim-text {
    flex: 1;
    color: #e0e0e0;
    line-height: 1.4;

    &.untitled {
      color: #888;
      font-style: italic;
    }
  }

  .aim-description {
    font-size: 0.9rem;
    color: #bbb;
    white-space: pre-wrap;
    margin-bottom: 0.25rem;
    padding-left: 0.25rem;
    border-left: 2px solid #444;
  }

  .aim-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    padding-left: 0.25rem;

    .tag {
      font-size: 0.75rem;
      color: #88ccff;
      background: rgba(0, 122, 204, 0.1);
      padding: 0.1rem 0.3rem;
      border-radius: 0.2rem;
    }
  }

  .sub-aim-count-bubble {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.5);
    color: #333;
    font-weight: bold;
    font-size: 0.8rem;
    padding: 0 0.4rem;
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