<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useDataStore, type Phase} from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useProjectStore } from '../stores/project-store'
import AimsList from './AimsList.vue'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue'
import { useLongPress } from '../composables/useLongPress'
import { perfLog } from '../utils/perf-log'

interface Props {
  phase: Phase
  isSelected: boolean
  isActive: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'scroll-request': [element: HTMLElement]
  'aim-clicked': [aimId: string, modifiers?: { ctrl: boolean; shift: boolean }]
  'phase-clicked': []
}>()

const phaseContainerRef = ref<HTMLElement | null>(null)

const dataStore = useDataStore()
const uiStore = useUIStore()
const projectStore = useProjectStore()

// Get aims from the store
const phaseAims = computed(() => dataStore.getAimsForPhase(props.phase.id))

// Load aims and scroll on mount
onMounted(() => {
  perfLog('phase.mount', {
    phaseId: props.phase.id,
    phaseName: props.phase.name,
    isSelected: props.isSelected,
    isActive: props.isActive
  })
  dataStore.loadPhaseAims(projectStore.projectPath, props.phase.id)
})

// Check if this phase is pending delete
const isPendingDelete = computed(() => {
  return uiStore.pendingDeletePhaseId === props.phase.id
})

// On the current phase path (marked via `c`)
const isCurrent = computed(() => uiStore.currentPhaseIdSet.has(props.phase.id))

// Long-press context menu — one button per phase keyboard shortcut. Each item
// re-dispatches the matching key through the same handler the keyboard uses, so
// behaviour stays identical (including inline-only actions like reorder).
const showMenu = ref(false)
const menuX = ref(0)
const menuY = ref(0)

const dispatchKey = (key: string) =>
  uiStore.handleGlobalKeydown(new KeyboardEvent('keydown', { key }), dataStore)

const openMenu = (event: PointerEvent) => {
  emit('phase-clicked')        // select this phase first
  uiStore.navigatingAims = false // ensure column (phase) shortcuts are routed
  menuX.value = event.clientX
  menuY.value = event.clientY
  showMenu.value = true
}

const longPress = useLongPress(openMenu)

// Add an aim to an *empty* phase. With existing aims you just tap (or long-press)
// an aim directly, so "enter aims"/"add aim" only makes sense when there are none.
// Mirrors the keyboard flow: `i` enters aim mode for the phase, `o` opens the
// create-aim modal against it.
const addAimToEmptyPhase = async () => {
  await dispatchKey('i')
  await dispatchKey('o')
}

const phaseMenuItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    { id: 'add-before', label: 'Add phase before', run: () => dispatchKey('O') },
    { id: 'add-after', label: 'Add phase after', run: () => dispatchKey('o') },
    { id: 'edit', label: 'Edit phase', run: () => dispatchKey('e') }
  ]
  if (phaseAims.value.length === 0) {
    items.push({ id: 'add-aim', label: 'Add aim', run: addAimToEmptyPhase })
  }
  items.push(
    { id: 'mark-current', label: 'Mark as current', run: () => dispatchKey('c') },
    { id: 'move-up', label: 'Move up', run: () => dispatchKey('K') },
    { id: 'move-down', label: 'Move down', run: () => dispatchKey('J') },
    {
      id: 'delete',
      label: 'Delete phase',
      confirm: true,
      confirmLabel: 'Confirm delete',
      danger: true,
      run: () => dispatchKey('d')
    }
  )
  return items
})
</script>

<template>
  <div
    ref="phaseContainerRef"
    class="phase-container"
    :class="{
      'active': isActive,
      'selected': isSelected,
      'current': isCurrent,
      'pending-delete': isPendingDelete,
      /* Phase is the action target when selected in this column and not in aim mode. */
      'action-target': isActive && !uiStore.navigatingAims
    }"
    @click="$emit('phase-clicked')"
  >
    <div
      class="phase-header"
      @pointerdown="longPress.onPointerDown"
      @pointermove="longPress.onPointerMove"
      @pointerup="longPress.onPointerUp"
      @pointercancel="longPress.onPointerCancel"
      @pointerleave="longPress.onPointerLeave"
      @contextmenu.prevent
    >
      <div class="phase-name">{{ phase.name }}</div>
    </div>

    <ContextMenu
      v-if="showMenu"
      :items="phaseMenuItems"
      :x="menuX"
      :y="menuY"
      @close="showMenu = false"
    />

    <!-- Aims List -->
    <div class="aims-container">
      <AimsList
        :aims="phaseAims"
        :phase-id="phase.id"
        :column-index="0"
        :is-active="isActive && uiStore.navigatingAims"
        :is-selected="isSelected"
        :selected-aim-index="phase.selectedAimIndex"
        :aim-ui-states="uiStore.getPhaseAimUIStates(phase.id)"
        @scroll-request="$emit('scroll-request', $event)"
        @aim-clicked="(id, mods) => $emit('aim-clicked', id, mods)"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-container {
  padding: 0;
  margin-bottom: 0;
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  overflow: hidden;
}

.phase-container.selected {
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;

  &.active {
    outline-color: #007acc;
  }
}

/* Current phase path (marked via `c`): default phase bg + 0.2 * open-state color */
.phase-container.current {
  background: linear-gradient(rgba(0, 85, 142, 0.2), rgba(0, 85, 142, 0.2)), rgba(255, 255, 255, 0.1);
}

/* Action-target phase: 10% brighter on top of base / current tint. */
.phase-container.action-target {
  background:
    linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)),
    rgba(255, 255, 255, 0.1);
}

.phase-container.current.action-target {
  background:
    linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)),
    linear-gradient(rgba(0, 85, 142, 0.2), rgba(0, 85, 142, 0.2)),
    rgba(255, 255, 255, 0.1);
}

.phase-container.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}

.phase-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  padding-top: 0.3rem;
}

.phase-name {
  font-weight: bold;
  color: #e0e0e0;
}

.aims-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 0 0.5rem;
}

.empty-hint {
  font-size: 0.7rem;
  color: #666;
  font-style: italic;
  padding: 0.25rem 0;
}

.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}
</style>
