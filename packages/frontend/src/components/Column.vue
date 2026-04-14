<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useScrollIntoView } from '../composables/useScrollIntoView'
import PhaseComponent from './Phase.vue'
import type { PhaseLevelEntry } from '../stores/data'

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
const measuredHeightByKey = ref(new Map<string, number>())
const scrollTop = ref(0)
const viewportHeight = ref(0)
const resizeObserver = ref<ResizeObserver | null>(null)
const hasInitialAnchorPosition = ref(false)

const ESTIMATED_PHASE_HEIGHT = 180
const ESTIMATED_PLACEHOLDER_HEIGHT = 56
const ESTIMATED_SEPARATOR_HEIGHT = 17
const OVERSCAN_COUNT = 4

const entries = computed(() => dataStore.getColumnEntries(props.columnIndex))
const selectableEntries = computed(() => dataStore.getSelectableColumnEntries(props.columnIndex))

const getEstimatedHeight = (entry: PhaseLevelEntry) => {
  if (entry.type === 'phase') return ESTIMATED_PHASE_HEIGHT
  if (entry.type === 'placeholder') return ESTIMATED_PLACEHOLDER_HEIGHT
  return ESTIMATED_SEPARATOR_HEIGHT
}

const heights = computed(() => entries.value.map((entry) => (
  measuredHeightByKey.value.get(entry.key) ?? getEstimatedHeight(entry)
)))

const offsets = computed(() => {
  const nextOffsets: number[] = new Array(entries.value.length)
  let runningTop = 0

  for (let index = 0; index < entries.value.length; index++) {
    nextOffsets[index] = runningTop
    runningTop += heights.value[index] ?? 0
  }

  return nextOffsets
})

const totalHeight = computed(() => {
  if (entries.value.length === 0) return 0
  const lastIndex = entries.value.length - 1
  return (offsets.value[lastIndex] ?? 0) + (heights.value[lastIndex] ?? 0)
})

const findFirstVisibleIndex = (targetTop: number) => {
  let low = 0
  let high = entries.value.length - 1
  let answer = entries.value.length

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const rowBottom = (offsets.value[mid] ?? 0) + (heights.value[mid] ?? 0)
    if (rowBottom > targetTop) {
      answer = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  return answer
}

const findLastVisibleIndex = (targetBottom: number) => {
  let low = 0
  let high = entries.value.length - 1
  let answer = -1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const rowTop = offsets.value[mid] ?? 0
    if (rowTop < targetBottom) {
      answer = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return answer
}

const visibleRange = computed(() => {
  if (entries.value.length === 0) {
    return { start: 0, end: -1 }
  }

  const firstVisible = findFirstVisibleIndex(scrollTop.value)
  const lastVisible = findLastVisibleIndex(scrollTop.value + viewportHeight.value)

  if (firstVisible > lastVisible || firstVisible >= entries.value.length) {
    return { start: 0, end: Math.min(entries.value.length - 1, OVERSCAN_COUNT) }
  }

  return {
    start: Math.max(0, firstVisible - OVERSCAN_COUNT),
    end: Math.min(entries.value.length - 1, lastVisible + OVERSCAN_COUNT)
  }
})

const visibleEntries = computed(() => {
  const rendered: Array<PhaseLevelEntry & { index: number; top: number }> = []
  for (let index = visibleRange.value.start; index <= visibleRange.value.end; index++) {
    const entry = entries.value[index]
    if (!entry) continue
    rendered.push({
      ...entry,
      index,
      top: offsets.value[index] ?? 0
    })
  }
  return rendered
})

const getSelectableIndex = (entryKey: string) => {
  return selectableEntries.value.findIndex((entry) => entry.key === entryKey)
}

const getSelectedEntry = () => selectableEntries.value[props.selectedPhaseIndex]

const getSelectedEntryIndexInColumn = () => {
  const selectedEntry = getSelectedEntry()
  if (!selectedEntry) return -1
  return entries.value.findIndex((entry) => entry.key === selectedEntry.key)
}

const updateViewportMetrics = () => {
  const container = phaseListRef.value
  if (!container) return
  scrollTop.value = container.scrollTop
  viewportHeight.value = container.clientHeight
}

const adjustScrollForHeightChange = (entryIndex: number, delta: number) => {
  const container = phaseListRef.value
  if (!container || delta === 0) return
  const selectedEntryIndex = getSelectedEntryIndexInColumn()
  if (selectedEntryIndex < 0 || entryIndex >= selectedEntryIndex) return
  container.scrollTop += delta
  updateViewportMetrics()
}

const getOuterHeight = (element: HTMLElement) => {
  const style = window.getComputedStyle(element)
  const marginTop = parseFloat(style.marginTop || '0')
  const marginBottom = parseFloat(style.marginBottom || '0')
  return element.offsetHeight + marginTop + marginBottom
}

const measureEntryElement = (entryKey: string, element: HTMLElement) => {
  const measuredHeight = getOuterHeight(element)
  if (measuredHeight <= 0) return

  const entryIndex = entries.value.findIndex((entry) => entry.key === entryKey)
  const previousHeight = measuredHeightByKey.value.get(entryKey) ?? (entryIndex >= 0 ? getEstimatedHeight(entries.value[entryIndex]!) : measuredHeight)
  if (previousHeight === measuredHeight) return

  measuredHeightByKey.value.set(entryKey, measuredHeight)
  if (entryIndex >= 0) {
    adjustScrollForHeightChange(entryIndex, measuredHeight - previousHeight)
  }
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
    measureEntryElement(entryKey, resolvedElement)
    resizeObserver.value?.observe(resolvedElement)
  } else {
    const previous = entryElements.value.get(entryKey)
    if (previous) {
      resizeObserver.value?.unobserve(previous)
    }
    entryElements.value.delete(entryKey)
  }
}

const setInitialAnchorScrollIfNeeded = async () => {
  if (hasInitialAnchorPosition.value) return

  await nextTick()
  const container = phaseListRef.value
  const entryIndex = getSelectedEntryIndexInColumn()
  if (!container || entryIndex < 0) return

  const estimatedTop = offsets.value[entryIndex] ?? 0
  const estimatedHeight = heights.value[entryIndex] ?? 0
  const targetTop = Math.max(0, estimatedTop - container.clientHeight * 0.25 + estimatedHeight * 0.5)

  container.scrollTop = targetTop
  hasInitialAnchorPosition.value = true
  updateViewportMetrics()
}

const scrollSelectedEntryIntoView = async () => {
  await nextTick()
  const selectedEntry = getSelectedEntry()
  if (!selectedEntry) return

  const entryIndex = entries.value.findIndex((entry) => entry.key === selectedEntry.key)
  if (entryIndex < 0 || !phaseListRef.value) return

  const container = phaseListRef.value
  const top = offsets.value[entryIndex] ?? 0
  const height = heights.value[entryIndex] ?? 0
  const bottom = top + height
  const viewTop = container.scrollTop
  const viewBottom = viewTop + container.clientHeight
  const bandTop = viewTop + container.clientHeight * 0.25
  const bandBottom = viewTop + container.clientHeight * 0.75

  if (top < bandTop) {
    container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.2), behavior: 'smooth' })
    return
  }

  if (bottom > bandBottom) {
    container.scrollTo({ top: Math.max(0, bottom - container.clientHeight * 0.8), behavior: 'smooth' })
    return
  }

  if (top < viewTop || bottom > viewBottom) {
    const element = entryElements.value.get(selectedEntry.key)
    if (element) {
      handleScrollRequest(element)
    }
  }
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
    if (!hasInitialAnchorPosition.value) {
      void setInitialAnchorScrollIfNeeded()
      return
    }
    void scrollSelectedEntryIntoView()
  },
  { flush: 'post' }
)

watch(() => entries.value.map((entry) => entry.key).join('|'), async () => {
  if (entries.value.length === 0) {
    hasInitialAnchorPosition.value = false
  }
  await nextTick()
  updateViewportMetrics()
}, { flush: 'post' })

onMounted(() => {
  updateViewportMetrics()
  resizeObserver.value = new ResizeObserver((observedEntries) => {
    for (const observedEntry of observedEntries) {
      const element = observedEntry.target
      if (!(element instanceof HTMLElement)) continue
      for (const [entryKey, registeredElement] of entryElements.value.entries()) {
        if (registeredElement === element) {
          measureEntryElement(entryKey, element)
          break
        }
      }
    }
  })
  void setInitialAnchorScrollIfNeeded()
})

onBeforeUnmount(() => {
  resizeObserver.value?.disconnect()
  resizeObserver.value = null
})
</script>

<template>
  <div class="column-panel" :class="{ 'active': isActive, 'selected': isSelected }">
    <div v-if="entries.length === 0" class="empty-state">
      No sub phases, create one with o
    </div>

    <div
      v-else
      ref="phaseListRef"
      class="column-list"
      @scroll="updateViewportMetrics"
    >
      <div class="virtual-column-space" :style="{ height: `${totalHeight}px` }">
        <template v-for="entry in visibleEntries" :key="entry.key">
        <hr
          v-if="entry.type === 'separator'"
          class="parent-separator virtual-entry"
          :style="{ transform: `translateY(${entry.top}px)` }"
        />
        <div
          v-else-if="entry.type === 'placeholder'"
          :ref="(element) => setEntryElement(entry.key, element)"
          class="column-placeholder virtual-entry"
          :style="{ transform: `translateY(${entry.top}px)` }"
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
          class="column-entry virtual-entry"
          :style="{ transform: `translateY(${entry.top}px)` }"
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
  position: relative;

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

.virtual-column-space {
  position: relative;
  min-height: 100%;
}

.virtual-entry {
  position: absolute;
  left: 0;
  right: 0;
}

.parent-separator {
  border: 0;
  border-top: 1px solid #555;
  margin: 0.5rem 0;
  box-sizing: border-box;
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
