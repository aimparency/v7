<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useDataStore, type Phase} from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useUIModalStore } from '../stores/ui/modal-store'
import IdeasList from './IdeasList.vue'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue'
import { useLongPress } from '../composables/useLongPress'
import { perfLog } from '../utils/perf-log'
import { formatIdeaPriority, rankIdeasForPhaseTree } from '../utils/phase-priority'

interface Props {
  phase: Phase
  isSelected: boolean
  isActive: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'scroll-request': [element: HTMLElement]
  'idea-clicked': [ideaId: string, modifiers?: { ctrl: boolean; shift: boolean }]
  'phase-clicked': []
}>()

const phaseContainerRef = ref<HTMLElement | null>(null)

const dataStore = useDataStore()
const uiStore = useUIStore()
const modalStore = useUIModalStore()

const showPriority = ref(false)
const priorityState = ref('human-dependent')

const prioritizedIdeas = computed(() => rankIdeasForPhaseTree(
  props.phase.id,
  dataStore.phases,
  dataStore.ideas,
  dataStore.calculatedPriorities,
  priorityState.value
))

const togglePriority = () => {
  showPriority.value = !showPriority.value
}

const openPrioritizedIdea = (ideaId: string) => {
  modalStore.openIdeaEditModal(ideaId)
}

// Get ideas from the store
const phaseIdeas = computed(() => dataStore.getIdeasForPhase(props.phase.id))

// Load ideas and scroll on mount
onMounted(() => {
  perfLog('phase.mount', {
    phaseId: props.phase.id,
    phaseName: props.phase.name,
    isSelected: props.isSelected,
    isActive: props.isActive
  })
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
  uiStore.navigatingIdeas = false // ensure column (phase) shortcuts are routed
  menuX.value = event.clientX
  menuY.value = event.clientY
  showMenu.value = true
}

const longPress = useLongPress(openMenu)

// Add an idea to an *empty* phase. With existing ideas you just tap (or long-press)
// an idea directly, so "enter ideas"/"add idea" only makes sense when there are none.
// Mirrors the keyboard flow: `i` enters idea mode for the phase, `o` opens the
// create-idea modal against it.
const addIdeaToEmptyPhase = async () => {
  await dispatchKey('i')
  await dispatchKey('o')
}

const phaseMenuItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    { id: 'add-before', label: 'Add phase before', run: () => dispatchKey('O') },
    { id: 'add-after', label: 'Add phase after', run: () => dispatchKey('o') },
    { id: 'edit', label: 'Edit phase', run: () => dispatchKey('e') }
  ]
  if (phaseIdeas.value.length === 0) {
    items.push({ id: 'add-idea', label: 'Add idea', run: addIdeaToEmptyPhase })
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
      /* Phase is the action target when selected in this column and not in idea mode. */
      'action-target': isActive && !uiStore.navigatingIdeas
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
      <button
        type="button"
        class="priority-toggle"
        :class="{ active: showPriority }"
        :aria-expanded="showPriority"
        :aria-controls="`phase-priority-${phase.id}`"
        @pointerdown.stop
        @click.stop="togglePriority"
      >
        {{ showPriority ? 'hide priority list' : 'list by priority' }}
      </button>
    </div>

    <ContextMenu
      v-if="showMenu"
      :items="phaseMenuItems"
      :x="menuX"
      :y="menuY"
      @close="showMenu = false"
    />

    <section
      v-if="showPriority"
      :id="`phase-priority-${phase.id}`"
      class="priority-panel"
      @click.stop
    >
      <label class="priority-state">
        <span>State</span>
        <select v-model="priorityState">
          <option
            v-for="status in dataStore.getStatuses"
            :key="status.key"
            :value="status.key"
          >
            {{ status.key }}
          </option>
        </select>
      </label>

      <div class="priority-summary">
        Direct and transitive ideas across this phase and its subphases
      </div>

      <div v-if="prioritizedIdeas.length === 0" class="priority-empty">
        No {{ priorityState }} ideas
      </div>
      <ol v-else class="priority-list">
        <li v-for="result in prioritizedIdeas" :key="result.idea.id">
          <button
            type="button"
            class="priority-idea"
            :title="`Edit ${result.idea.text || 'untitled idea'}`"
            @click="openPrioritizedIdea(result.idea.id)"
          >
            <span class="priority-rank">{{ formatIdeaPriority(result.priority) }}</span>
            <span class="priority-copy">
              <span class="priority-text">{{ result.idea.text || '(untitled)' }}</span>
              <span class="priority-phase">
                {{ dataStore.phases[result.phaseId]?.name || 'This phase' }}
                {{ result.directlyCommitted ? '' : ' · via committed idea' }}
              </span>
            </span>
          </button>
        </li>
      </ol>
    </section>

    <!-- Ideas List -->
    <div v-else class="ideas-container">
      <IdeasList
        :ideas="phaseIdeas"
        :phase-id="phase.id"
        :column-index="0"
        :is-active="isActive && uiStore.navigatingIdeas"
        :is-selected="isSelected"
        :selected-idea-index="phase.selectedIdeaIndex"
        :idea-ui-states="uiStore.getPhaseIdeaUIStates(phase.id)"
        @scroll-request="$emit('scroll-request', $event)"
        @idea-clicked="(id, mods) => $emit('idea-clicked', id, mods)"
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.priority-toggle {
  flex: none;
  margin-left: 0.5rem;
  border: 1px solid #666;
  border-radius: 0.25rem;
  padding: 0.2rem 0.4rem;
  background: rgba(0, 0, 0, 0.18);
  color: #cfcfcf;
  font: inherit;
  font-size: 0.68rem;
  cursor: pointer;
}

.priority-toggle:hover,
.priority-toggle.active {
  border-color: #d2a84a;
  color: #ffd778;
}

.priority-panel {
  padding: 0 0.5rem 0.5rem;
}

.priority-state {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #aaa;
  font-size: 0.7rem;
}

.priority-state select {
  min-width: 0;
  flex: 1;
  border: 1px solid #555;
  border-radius: 0.2rem;
  padding: 0.2rem 0.3rem;
  background: #292929;
  color: #eee;
}

.priority-summary,
.priority-empty {
  padding: 0.35rem 0;
  color: #888;
  font-size: 0.65rem;
}

.priority-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.priority-idea {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.45rem;
  border: 1px solid #484848;
  border-radius: 0.2rem;
  padding: 0.35rem;
  background: rgba(0, 0, 0, 0.16);
  color: #e4e4e4;
  text-align: left;
  cursor: pointer;
}

.priority-idea:hover {
  border-color: #d2a84a;
  background: rgba(210, 168, 74, 0.1);
}

.priority-rank {
  flex: none;
  min-width: 3.2rem;
  color: #ffd778;
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;
  font-weight: bold;
}

.priority-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
}

.priority-text {
  overflow-wrap: anywhere;
  font-size: 0.75rem;
}

.priority-phase {
  overflow: hidden;
  color: #888;
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ideas-container {
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
