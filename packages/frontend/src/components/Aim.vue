<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from 'vue'
import type { Aim } from '../stores/data'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useProjectStore } from '../stores/project-store'
import type { AimUIState } from '../stores/ui/aim-ui-state'
import AimsList from './AimsList.vue'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue'
import { useLongPress } from '../composables/useLongPress'

defineOptions({ inheritAttrs: false })

interface Props {
  aim: Aim
  indentationLevel?: number
  isActive?: boolean
  isSelected?: boolean
  isThisAimSelected?: boolean
  phaseId: string
  columnIndex: number
  parentAimId?: string
  aimUiState: AimUIState
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0,
  isActive: false,
  isSelected: false,
  isThisAimSelected: false,
  parentAimId: undefined
})

const emit = defineEmits<{
  'aim-clicked': [aimId: string, modifiers?: { ctrl: boolean; shift: boolean }]
  'scroll-request': [element: HTMLElement]
}>()

const attrs = useAttrs()
const aimContainerRef = ref<HTMLElement | null>(null)
const dataStore = useDataStore()
const uiStore = useUIStore()
const projectStore = useProjectStore()

// Long-press context menu — one button per aim keyboard shortcut, dispatched
// through the same handler the keyboard uses (so behaviour stays identical).
const showMenu = ref(false)
const menuX = ref(0)
const menuY = ref(0)
let lastMenuOpenAt = 0

const dispatchKey = (key: string) =>
  uiStore.handleGlobalKeydown(new KeyboardEvent('keydown', { key }), dataStore)

// Tap normally selects/edits; swallow the click that trails a long-press so the
// menu doesn't also re-trigger selection (which would pop the edit modal).
const onAimClick = (event?: MouseEvent) => {
  if (Date.now() - lastMenuOpenAt < 600) return

  const modifiers = event
    ? { ctrl: !!(event.ctrlKey || event.metaKey), shift: !!event.shiftKey }
    : { ctrl: false, shift: false }

  // For multi-select modifier clicks, let the parent decide (toggle multi + optional primary)
  emit('aim-clicked', props.aim.id, modifiers)
}

const openMenu = (event: PointerEvent) => {
  // Select this aim via the normal chain (Column knows the real column index).
  // Skip if already selected, since re-selecting opens the edit modal.
  if (!props.isThisAimSelected) {
    emit('aim-clicked', props.aim.id)
  }
  uiStore.navigatingAims = true
  lastMenuOpenAt = Date.now()
  menuX.value = event.clientX
  menuY.value = event.clientY
  showMenu.value = true
}

const longPress = useLongPress(openMenu)

const aimMenuItems = computed<ContextMenuItem[]>(() => {
  const base: ContextMenuItem[] = [
    { id: 'add-before', label: 'Add aim before', run: () => dispatchKey('O') },
    { id: 'add-after', label: 'Add aim after', run: () => dispatchKey('o') },
    { id: 'edit', label: 'Edit aim', run: () => dispatchKey('e') },
    { id: 'move-up', label: 'Move up', run: () => dispatchKey('K') },
    { id: 'move-down', label: 'Move down', run: () => dispatchKey('J') },
    { id: 'make-child', label: 'Make child', run: () => dispatchKey('L') },
    { id: 'elevate', label: 'Elevate (make sibling)', run: () => dispatchKey('H') },
    { id: 'cut', label: 'Cut', run: () => dispatchKey('x') },
    { id: 'copy', label: 'Copy', run: () => dispatchKey('c') },
    { id: 'paste', label: 'Paste', run: () => dispatchKey('p') },
    { id: 'parents', label: 'Show parent paths', run: () => dispatchKey('s') },
    {
      id: 'delete',
      label: 'Delete aim',
      confirm: true,
      confirmLabel: 'Confirm delete',
      danger: true,
      run: () => dispatchKey('d')
    }
  ]

  // Multi-select merge action (supports "merge aims" feature from current week)
  if (uiStore.multiSelectCount > 1 && uiStore.isMultiSelected(props.aim.id)) {
    const otherCount = uiStore.multiSelectCount - 1
    base.push({
      id: 'merge-selected-into',
      label: `Merge ${otherCount} other selected into this`,
      confirm: true,
      confirmLabel: 'Confirm merge (this aim is kept; others archived after rewiring connections)',
      run: async () => {
        const result = await uiStore.mergeSelectedInto(props.aim.id)
        if (result?.success) {
          uiStore.clearMultiSelect()
        }
      }
    })
  }

  if (uiStore.multiSelectCount > 0) {
    base.push({
      id: 'clear-multi',
      label: `Clear multi-select (${uiStore.multiSelectCount})`,
      run: () => uiStore.clearMultiSelect()
    })
  }

  return base
})

const hasIncomingAims = computed(() => props.aim.supportingConnections && props.aim.supportingConnections.length > 0)
const isExpanded = computed(() => props.aimUiState.expanded)

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

const otherParentAims = computed(() => {
  if (!parentAims.value) return []
  return parentAims.value.filter(p => p.id !== props.parentAimId)
})

const hasMultipleParents = computed(() => parentAims.value.length > 1)

const isMultiSelected = computed(() => uiStore.isMultiSelected(props.aim.id))

const statusColor = computed(() => {
    const colorMap: Record<string, string> = {}
    dataStore.getStatuses.forEach((s: any) => {
      colorMap[s.key] = s.color
    })
    return colorMap[props.aim.status.state] ?? '#888'
  })
// Scroll into view when this aim becomes selected or active
watch(() => [props.isThisAimSelected, props.isActive], ([isSelected, isActive]) => {
  const hasSelectedChild = isExpanded.value && props.aimUiState.selectedIncomingIndex !== undefined
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
    :class="[attrs.class, { 
      expanded: isExpanded,
      'multi-selected': isMultiSelected 
    }]"
    @click.stop="onAimClick($event)"
  >
    <!-- Aim content -->
    <div class="aim-content">
      <div
        class="aim-header"
        @pointerdown="longPress.onPointerDown"
        @pointermove="longPress.onPointerMove"
        @pointerup="longPress.onPointerUp"
        @pointercancel="longPress.onPointerCancel"
        @pointerleave="longPress.onPointerLeave"
        @contextmenu.prevent
      >
        <div class="aim-main">
          <div class="aim-text" :class="{ 'untitled': !aim.text }">
            {{ aim.text || '(untitled)' }}
            <span v-if="isMultiSelected" class="multi-badge" title="Multi-selected">●</span>
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

        <div v-if="otherParentAims.length > 0" class="aim-parents">
          <div class="parents-label">{{ parentAimId ? 'Also supports:' : 'Supports:' }}</div>
          <div class="parents-list">
            <button
              v-for="parent in otherParentAims"
              :key="parent.id"
              class="parent-aim"
              @click.stop="$emit('aim-clicked', parent.id, { ctrl: false, shift: false })"
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

    <ContextMenu
      v-if="showMenu"
      :items="aimMenuItems"
      :x="menuX"
      :y="menuY"
      @close="showMenu = false"
    />

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
        :aim-ui-states="aimUiState.children"
        :is-active="isActive && isThisAimSelected"
        :is-selected="isSelected && isThisAimSelected"
        :selected-aim-index="aimUiState.selectedIncomingIndex"
        @scroll-request="$emit('scroll-request', $event)"
        @aim-clicked="(id, mods) => $emit('aim-clicked', id, mods)"
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

  &.multi-selected {
    background-color: rgba(100, 180, 255, 0.15);
    outline: 1px dashed #4a9eff;
    outline-offset: -1px;
  }

  /* When both primary selected and multi-selected, multi bg + selected outline wins visually */
  &.selected.multi-selected {
    background-color: rgba(100, 180, 255, 0.25);
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

  .multi-badge {
    display: inline-block;
    margin-left: 0.35rem;
    font-size: 0.7em;
    color: #4a9eff;
    vertical-align: middle;
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
