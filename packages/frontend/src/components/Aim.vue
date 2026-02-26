<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from 'vue'
import type { Aim } from '../stores/data'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
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
const projectStore = useProjectStore()

const hasIncomingAims = computed(() => props.aim.supportingConnections && props.aim.supportingConnections.length > 0)
const isExpanded = computed(() => props.aim.expanded || false)

const subAimCount = computed(() => {
  return props.aim.supportingConnections?.length || 0
})

const parentAimCount = computed(() => {
  return props.aim.supportedAims?.length || 0
})

const totalValue = computed(() => {
  return Math.round(dataStore.getAimValue(props.aim.id))
})

const totalCost = computed(() => {
  return Math.round(dataStore.getAimCost(props.aim.id))
})

const intrinsicValue = computed(() => {
  return Math.round(props.aim.intrinsicValue || 0)
})

const intrinsicCost = computed(() => {
  return Math.round(props.aim.cost || 0)
})

const hasStats = computed(() =>
  totalValue.value > 0 || totalCost.value > 0 ||
  subAimCount.value > 0 || parentAimCount.value > 0
)

// Get incoming aims from the data store
const incomingAims = computed(() => {
  if (!hasIncomingAims.value || !props.aim.supportingConnections) return []
  return props.aim.supportingConnections
    .map(conn => dataStore.aims[conn.aimId])
    .filter((a): a is Aim => !!a)
})

// Get parent aims (supportedAims) from the data store
const parentAims = computed(() => {
  if (!props.aim.supportedAims || props.aim.supportedAims.length === 0) return []
  return props.aim.supportedAims
    .map(parentId => dataStore.aims[parentId])
    .filter((a): a is Aim => !!a)
})

const hasMultipleParents = computed(() => parentAims.value.length > 1)

  const statusColor = computed(() => {
    const colorMap: Record<string, string> = {}
    dataStore.getStatuses.forEach((s: any) => {
      colorMap[s.key] = s.color
    })
    return colorMap[props.aim.status.state] ?? '#888'
  })
// Scroll into view when this aim becomes selected or active
watch(() => [props.isThisAimSelected, props.isActive], ([isSelected, isActive]) => {
  const hasSelectedChild = isExpanded.value && props.aim.selectedIncomingIndex !== undefined
  if (isSelected && isActive && !hasSelectedChild && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
}, { flush: 'post' })

// Ensure sub-aims and parent aims are loaded when expanded
watch(isExpanded, (newVal) => {
  if (newVal) {
    // Load child aims (supportingConnections)
    if (props.aim.supportingConnections && props.aim.supportingConnections.length > 0) {
      dataStore.loadAims(projectStore.projectPath, props.aim.supportingConnections.map(c => c.aimId))
    }
    // Load parent aims (supportedAims)
    if (props.aim.supportedAims && props.aim.supportedAims.length > 0) {
      dataStore.loadAims(projectStore.projectPath, props.aim.supportedAims)
    }
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
      <div class="aim-header">
        <div class="aim-main">
          <div class="aim-text" :class="{ 'untitled': !aim.text }">
            {{ aim.text || '(untitled)' }}
          </div>
          <div class="aim-status" :style="{ color: statusColor }">
            {{ aim.status.state }}
          </div>
        </div>

        <div v-if="hasStats" class="stats-container">
          <div class="stat-box" :title="`Supported aims: ${parentAimCount} | Supporting aims: ${subAimCount}`">
            <div class="stat-top">{{ parentAimCount }}</div>
            <div class="stat-bottom">{{ subAimCount }}</div>
          </div>
          <div class="stat-box" :title="`Total cost: ${totalCost} | Intrinsic cost: ${intrinsicCost}`">
            <div class="stat-top cost">{{ totalCost }}</div>
            <div class="stat-bottom cost">{{ intrinsicCost }}</div>
          </div>
          <div class="stat-box" :title="`Total value: ${totalValue} | Intrinsic value: ${intrinsicValue}`">
            <div class="stat-top value">{{ totalValue }}</div>
            <div class="stat-bottom value">{{ intrinsicValue }}</div>
          </div>
        </div>
      </div>
      
      <div v-if="isExpanded" class="aim-details">
        <div v-if="aim.description" class="aim-description">
          {{ aim.description }}
        </div>

        <div v-if="parentAims.length > 0" class="aim-parents">
          <div class="parents-label">Supports:</div>
          <div class="parents-list">
            <button
              v-for="parent in parentAims"
              :key="parent.id"
              class="parent-aim"
              @click.stop="$emit('aim-clicked', parent.id)"
              :title="`Navigate to: ${parent.text}`"
            >
              {{ parent.text || '(untitled)' }}
            </button>
          </div>
        </div>

        <div v-if="aim.tags && aim.tags.length > 0" class="aim-tags">
          <span v-for="tag in aim.tags" :key="tag" class="tag">#{{ tag }}</span>
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

  &.selected {
    outline-width: 0.15rem;
    outline-style: solid;
    outline-offset: -0.15rem;
    margin-left: -0.5rem;
    margin-right: -0.5rem;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    outline-color: #888;

    &.active {
      outline-color: #007acc;
    }
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

  .aim-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .aim-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  
  .aim-text {
    color: #e0e0e0;
    line-height: 1.4;
    word-break: break-word;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;

    &.untitled {
      color: #888;
      font-style: italic;
    }
  }

  .aim-status {
    font-size: 0.75rem;
    text-transform: uppercase;
    font-weight: bold;
  }

  .aim-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .aim-description {
    font-size: 0.9rem;
    color: #bbb;
    white-space: pre-wrap;
  }

  .aim-parents {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-left: 0.25rem;

    .parents-label {
      font-size: 0.75rem;
      color: #888;
      font-weight: bold;
      text-transform: uppercase;
    }

    .parents-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .parent-aim {
      font-size: 0.8rem;
      color: #b19cd9;
      background: rgba(138, 43, 226, 0.15);
      padding: 0.2rem 0.5rem;
      border-radius: 0.3rem;
      border: 1px solid rgba(138, 43, 226, 0.3);
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: rgba(138, 43, 226, 0.3);
        border-color: rgba(138, 43, 226, 0.5);
        color: #d0b3ff;
      }
    }
  }

  .aim-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-left: 0.25rem;

    .tag {
      font-size: 0.75rem;
      color: #88ccff;
      background: rgba(0, 122, 204, 0.1);
      padding: 0.1rem 0.3rem;
      border-radius: 0.2rem;
    }
  }

  .aim-comment {
    font-size: 0.8rem;
    color: #888;
    font-style: italic;
    padding-left: 0.25rem;
  }

  .stats-container {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    min-width: 1.5rem;
    border-radius: 0.2rem;
    overflow: hidden;
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);

    .stat-top {
      font-size: 0.65rem;
      padding: 0.15rem 0.25rem;
      text-align: center;
      line-height: 1.1;
      background-color: rgba(255, 255, 255, 0.1);
      color: #ccc;
      font-weight: bold;

      &.cost {
        background-color: rgba(0, 200, 200, 0.25);
        color: #fff;
      }

      &.value {
        background-color: rgba(255, 100, 200, 0.35);
        color: #fff;
      }
    }

    .stat-bottom {
      font-size: 0.65rem;
      padding: 0.15rem 0.25rem;
      text-align: center;
      line-height: 1.1;
      background-color: rgba(255, 255, 255, 0.05);
      color: #999;
      border-top: 1px solid rgba(255, 255, 255, 0.1);

      &.cost {
        background-color: rgba(0, 200, 200, 0.1);
        color: #70b3b3;
      }

      &.value {
        background-color: rgba(255, 100, 200, 0.15);
        color: #d988ba;
      }
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
