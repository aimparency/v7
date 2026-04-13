<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useScrollIntoView } from '../composables/useScrollIntoView'
import PhaseComponent from './Phase.vue'

interface Props {
  columnIndex: number
  isSelected: boolean
  isActive: boolean
  selectedPhaseIndex: number
}

const props = defineProps<Props>()

const dataStore = useDataStore()
const uiStore = useUIStore()

const phaseListRef = ref<HTMLElement | null>(null)
const entryElements = ref(new Map<string, HTMLElement>())

const entries = computed(() => dataStore.getColumnEntries(props.columnIndex))
const selectableEntries = computed(() => dataStore.getSelectableColumnEntries(props.columnIndex))

const getSelectableIndex = (entryKey: string) => {
  return selectableEntries.value.findIndex((entry) => entry.key === entryKey)
}

const setEntryElement = (
  entryKey: string,
  element: Element | ComponentPublicInstance | null
) => {
  const resolvedElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (resolvedElement) {
    entryElements.value.set(entryKey, resolvedElement)
  } else {
    entryElements.value.delete(entryKey)
  }
}

const scrollSelectedEntryIntoView = async () => {
  await nextTick()
  const selectedEntry = selectableEntries.value[props.selectedPhaseIndex]
  if (!selectedEntry) return

  const element = entryElements.value.get(selectedEntry.key)
  if (!element) return

  handleScrollRequest(element)
}

// Handle scroll requests from child components
const { handleScrollRequest } = useScrollIntoView(phaseListRef)

watch(() => uiStore.columnScrollIntent, (req) => {
  if (req && req.col === props.columnIndex && phaseListRef.value) {
    const behavior = 'smooth'
    if (req.direction === 'bottom') {
      phaseListRef.value.scrollTo({ top: phaseListRef.value.scrollHeight, behavior })
    } else if (req.direction === 'top') {
      phaseListRef.value.scrollTo({ top: 0, behavior })
    }
  }
})

watch(
  () => [props.selectedPhaseIndex, props.isSelected, entries.value.map((entry) => entry.key).join('|')],
  () => {
    if (props.isSelected) {
      void scrollSelectedEntryIntoView()
    }
  },
  { flush: 'post' }
)
</script>

<template>
  <div class="column-panel" :class="{ 'active': isActive, 'selected': isSelected }">
    <div v-if="entries.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div v-else ref="phaseListRef" class="column-list">
      <template v-for="entry in entries" :key="entry.key">
        <hr v-if="entry.type === 'separator'" class="parent-separator" />
        <div
          v-else-if="entry.type === 'placeholder'"
          :ref="(element) => setEntryElement(entry.key, element)"
          class="column-placeholder"
          :class="{
            'selected-item': getSelectableIndex(entry.key) === selectedPhaseIndex,
            'active-item': getSelectableIndex(entry.key) === selectedPhaseIndex && uiStore.activeColumn === columnIndex
          }"
          @click="() => uiStore.selectPhase(columnIndex, getSelectableIndex(entry.key))"
        >
          no sub phases yet. press o to create one
        </div>
        <div
          v-else
          :ref="(element) => setEntryElement(entry.key, element)"
          class="column-entry"
        >
          <PhaseComponent
            :phase="entry.phase"
            :is-selected="getSelectableIndex(entry.key) === selectedPhaseIndex"
            :is-active="getSelectableIndex(entry.key) === selectedPhaseIndex && uiStore.activeColumn === columnIndex"
            @phase-clicked="() => uiStore.selectPhase(columnIndex, getSelectableIndex(entry.key))"
            @aim-clicked="(aimId) => uiStore.selectAimById(columnIndex, entry.phase.id, aimId)"
            @scroll-request="handleScrollRequest"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.column-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column-panel.selected {
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;

  &.active {
    outline-color: #007acc;
  }
}

.column-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 0.375rem;
  }

  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 0.1875rem;

    &:hover {
      background: #666;
    }
  }

  /* Firefox scrollbar */
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.parent-separator {
  border: 0;
  border-top: 1px solid #555;
  margin: 0.5rem 0;
}

.column-entry {
  margin-bottom: 0.5rem;
}

.column-placeholder {
  padding: 0.75rem;
  border: 1px dashed #555;
  border-radius: 0.25rem;
  color: #888;
  font-style: italic;
  cursor: pointer;
}

.column-placeholder.selected-item {
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;
}

.column-placeholder.active-item {
  outline-color: #007acc;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}
</style>
