<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from 'vue'
import type { Idea } from '../stores/data'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import type { IdeaUIState } from '../stores/ui/idea-ui-state'
import IdeasList from './IdeasList.vue'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue'
import { useLongPress } from '../composables/useLongPress'

defineOptions({ inheritAttrs: false })

interface Props {
  idea: Idea
  indentationLevel?: number
  isActive?: boolean
  isSelected?: boolean
  isThisAimSelected?: boolean
  phaseId: string
  columnIndex: number
  parentAimId?: string
  ideaUiState: IdeaUIState
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0,
  isActive: false,
  isSelected: false,
  isThisAimSelected: false,
  parentAimId: undefined
})

const emit = defineEmits<{
  'idea-clicked': [ideaId: string, modifiers?: { ctrl: boolean; shift: boolean }]
  'scroll-request': [element: HTMLElement]
}>()

const attrs = useAttrs()
const ideaContainerRef = ref<HTMLElement | null>(null)
const dataStore = useDataStore()
const uiStore = useUIStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()

// Long-press context menu — one button per idea keyboard shortcut, dispatched
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
  emit('idea-clicked', props.idea.id, modifiers)
}

const openMenu = (_event: PointerEvent) => {
  if (uiStore.multiSelectMode && uiStore.isMultiSelected(props.idea.id)) {
    lastMenuOpenAt = Date.now()
    useUIModalStore().openAimEditModal(props.idea.id, [...uiStore.multiSelectedAimIds])
    return
  }

  if (uiStore.multiSelectMode) {
    uiStore.toggleMultiSelect(props.idea.id)
    uiStore.selectAimById(props.columnIndex, props.phaseId || undefined, props.idea.id).catch(() => {})
    uiStore.navigatingAims = true
    lastMenuOpenAt = Date.now()
    return
  }

  if (!props.isThisAimSelected) {
    uiStore.selectAimById(props.columnIndex, props.phaseId || undefined, props.idea.id).catch(() => {})
  }
  uiStore.enterMultiSelect(props.idea.id)
  uiStore.navigatingAims = true
  lastMenuOpenAt = Date.now()
}

const longPress = useLongPress(openMenu)

const ideaMenuItems = computed<ContextMenuItem[]>(() => {
  const base: ContextMenuItem[] = [
    { id: 'add-before', label: 'Add idea before', run: () => dispatchKey('O') },
    { id: 'add-after', label: 'Add idea after', run: () => dispatchKey('o') },
    { id: 'edit', label: 'Edit idea', run: () => dispatchKey('e') },
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
      label: 'Delete idea',
      confirm: true,
      confirmLabel: 'Confirm delete',
      danger: true,
      run: () => dispatchKey('d')
    }
  ]

  // Multi-select merge action (supports "merge ideas" feature from current week)
  if (uiStore.multiSelectCount > 1 && uiStore.isMultiSelected(props.idea.id)) {
    const otherCount = uiStore.multiSelectCount - 1
    base.push({
      id: 'merge-selected-into',
      label: `Merge ${otherCount} other selected into this`,
      confirm: true,
      confirmLabel: 'Confirm merge (this idea is kept; others archived after rewiring connections)',
      run: async () => {
        const result = await uiStore.mergeSelectedInto(props.idea.id)
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

const hasIncomingAims = computed(() => props.idea.supportingConnections && props.idea.supportingConnections.length > 0)
const isExpanded = computed(() => props.ideaUiState.expanded)

const subAimCount = computed(() => {
  return props.idea.supportingConnections?.length || 0
})

const parentAimCount = computed(() => {
  return props.idea.supportedAims?.length || 0
})

const totalValue = computed(() => {
  return Math.round(dataStore.getAimValue(props.idea.id))
})

const totalCost = computed(() => {
  return Math.round(dataStore.getAimCost(props.idea.id))
})

const intrinsicValue = computed(() => {
  return Math.round(props.idea.intrinsicValue || 0)
})

const intrinsicCost = computed(() => {
  return Math.round(props.idea.cost || 0)
})

const hasStats = computed(() =>
  totalValue.value > 0 || totalCost.value > 0 ||
  subAimCount.value > 0 || parentAimCount.value > 0
)

// Get incoming ideas from the data store
const incomingAims = computed(() => {
  if (!hasIncomingAims.value || !props.idea.supportingConnections) return []
  return props.idea.supportingConnections
    .map(conn => dataStore.ideas[conn.ideaId])
    .filter((a): a is Idea => !!a)
})

// Get parent ideas (supportedAims) from the data store
const parentAims = computed(() => {
  if (!props.idea.supportedAims || props.idea.supportedAims.length === 0) return []
  return props.idea.supportedAims
    .map(parentId => dataStore.ideas[parentId])
    .filter((a): a is Idea => !!a)
})

const otherParentAims = computed(() => {
  if (!parentAims.value) return []
  return parentAims.value.filter(p => p.id !== props.parentAimId)
})

const hasMultipleParents = computed(() => parentAims.value.length > 1)

const isMultiSelected = computed(() => uiStore.isMultiSelected(props.idea.id))

const editParentConnection = () => {
  if (!props.parentAimId) return
  modalStore.openConnectionDetailsModal(props.parentAimId, props.idea.id)
}

const statusColor = computed(() => {
    const colorMap: Record<string, string> = {}
    dataStore.getStatuses.forEach((s: any) => {
      colorMap[s.key] = s.color
    })
    return colorMap[props.idea.status.state] ?? '#888'
  })
// Keeping the selection in view during navigation is the column's job
// (useKeepSelectedAimVisible); ideas only request a scroll when they mount.

// Ensure sub-ideas and parent ideas are loaded when expanded
watch(isExpanded, (newVal) => {
  if (newVal) {
    // Load child ideas (supportingConnections)
    if (props.idea.supportingConnections && props.idea.supportingConnections.length > 0) {
      dataStore.loadAims(projectStore.projectPath, props.idea.supportingConnections.map(c => c.ideaId))
    }
    // Load parent ideas (supportedAims)
    if (props.idea.supportedAims && props.idea.supportedAims.length > 0) {
      dataStore.loadAims(projectStore.projectPath, props.idea.supportedAims)
    }
  }
}, { immediate: true })

// Scroll on mount if already selected (for cascade restoration)
onMounted(() => {
  if (props.isThisAimSelected && ideaContainerRef.value) {
    emit('scroll-request', ideaContainerRef.value)
  }
})
</script>

<template>
  <div
    ref="ideaContainerRef"
    class="idea-item"
    :class="[attrs.class, { 
      expanded: isExpanded,
      'multi-selected': isMultiSelected 
    }]"
    @click.stop="onAimClick($event)"
  >
    <!-- Idea content -->
    <div class="idea-content">
      <div
        class="idea-header"
        @pointerdown="longPress.onPointerDown"
        @pointermove="longPress.onPointerMove"
        @pointerup="longPress.onPointerUp"
        @pointercancel="longPress.onPointerCancel"
        @pointerleave="longPress.onPointerLeave"
        @contextmenu.prevent
      >
        <div class="idea-main">
          <div class="idea-text" :class="{ 'untitled': !idea.text }">
            {{ idea.text || '(untitled)' }}
            <span v-if="isMultiSelected" class="multi-badge" title="Multi-selected">●</span>
          </div>
          <div class="idea-status" :style="{ color: statusColor }">
            {{ idea.status.state }}
          </div>
        </div>

        <div v-if="hasStats" class="stats-container">
          <div class="stat-box" :title="`Supported ideas: ${parentAimCount} | Supporting ideas: ${subAimCount}`">
            <div class="stat-top">{{ parentAimCount }}</div>
            <div class="stat-bottom">{{ subAimCount }}</div>
          </div>
          <div class="stat-box" :title="`Total cost: ${totalCost} | Intrinsic cost: ${intrinsicCost}`">
            <div class="stat-top cost">{{ totalCost }}</div>
            <div class="stat-bottom cost">{{ intrinsicCost }}</div>
          </div>
          <div
            class="stat-box"
            :title="`Total value: ${totalValue} | Intrinsic value: ${intrinsicValue}${props.idea.valueRationale ? ` | Rationale: ${props.idea.valueRationale}` : ''}`"
          >
            <div class="stat-top value">{{ totalValue }}</div>
            <div class="stat-bottom value">{{ intrinsicValue }}</div>
          </div>
        </div>
        <button
          v-if="parentAimId"
          type="button"
          class="connection-edit-button"
          title="Edit contribution to parent"
          aria-label="Edit contribution to parent"
          @click.stop="editParentConnection"
        >↗</button>
      </div>
      
      <div v-if="isExpanded" class="idea-details">
        <div v-if="idea.description" class="idea-description">
          {{ idea.description }}
        </div>

        <div v-if="otherParentAims.length > 0" class="idea-parents">
          <div class="parents-label">{{ parentAimId ? 'Also supports:' : 'Supports:' }}</div>
          <div class="parents-list">
            <button
              v-for="parent in otherParentAims"
              :key="parent.id"
              class="parent-idea"
              @click.stop="$emit('idea-clicked', parent.id, { ctrl: false, shift: false })"
              :title="`Navigate to: ${parent.text}`"
            >
              {{ parent.text || '(untitled)' }}
            </button>
          </div>
        </div>

        <div v-if="idea.tags && idea.tags.length > 0" class="idea-tags">
          <span v-for="tag in idea.tags" :key="tag" class="tag">#{{ tag }}</span>
        </div>

        <div v-if="idea.status.comment" class="idea-comment">
          {{ idea.status.comment }}
        </div>
      </div>
    </div>

    <ContextMenu
      v-if="showMenu"
      :items="ideaMenuItems"
      :x="menuX"
      :y="menuY"
      @close="showMenu = false"
    />

    <!-- Expanded incoming ideas (recursive) -->
    <div v-if="isExpanded" class="incoming-ideas">
      <div class="indent-space" :style="{ width: `${2.3 * Math.pow(0.8, indentationLevel)}rem` }">
        <div class="indent-line"></div>
      </div>
      <IdeasList
        :ideas="incomingAims"
        :phase-id="phaseId"
        :parent-idea-id="idea.id"
        :column-index="columnIndex"
        :indentation-level="indentationLevel + 1"
        :idea-ui-states="ideaUiState.children"
        :is-active="isActive && isThisAimSelected"
        :is-selected="isSelected && isThisAimSelected"
        :selected-idea-index="ideaUiState.selectedIncomingIndex"
        @scroll-request="$emit('scroll-request', $event)"
        @idea-clicked="(id, mods) => $emit('idea-clicked', id, mods)"
      />
    </div>
  </div>
</template>

<style scoped>
.idea-item {
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

    /* Only the action target (active / blue border) gets a brighter bg. */
    &.active {
      outline-color: #007acc;
      background-color: rgba(255, 255, 255, 0.1);
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

  /* Active + multi: multi tint with action-target brightness layered on top. */
  &.selected.active.multi-selected {
    background:
      linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)),
      rgba(100, 180, 255, 0.15);
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

.idea-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  .idea-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .connection-edit-button {
    flex: 0 0 auto;
    padding: 0.1rem 0.35rem;
    color: #999;
    background: transparent;
    border: 1px solid #555;
    border-radius: 0.2rem;
    cursor: pointer;

    &:hover {
      color: #fff;
      border-color: #888;
    }
  }

  .idea-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  
  .idea-text {
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

  .idea-status {
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

  .idea-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .idea-description {
    font-size: 0.9rem;
    color: #bbb;
    white-space: pre-wrap;
  }

  .idea-parents {
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

    .parent-idea {
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

  .idea-tags {
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

  .idea-comment {
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

.incoming-ideas {
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

  .ideas-list-wrapper {
    flex: 1;
    min-width: 0;
  }
}
</style>
