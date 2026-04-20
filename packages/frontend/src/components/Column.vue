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
const pendingSelectionRealignTimeout = ref<number | null>(null)
const revealedPlaceholderKey = ref<string | null>(null)
const selectionTravelDirection = ref<'forward' | 'backward' | 'preserve'>('preserve')

const ESTIMATED_PHASE_HEIGHT = 180
const ESTIMATED_SEPARATOR_HEIGHT = 17
const OVERSCAN_COUNT = 4
const EDGE_PADDING_RATIO = 0.1
const PAGE_STEP_RATIO = 0.5
const SNAP_THRESHOLD_RATIO = 0.8

const entries = computed(() => dataStore.getColumnEntries(props.columnIndex))
const selectableEntries = computed(() => dataStore.getSelectableColumnEntries(props.columnIndex))

const getEstimatedHeight = (entry: PhaseLevelEntry) => {
  if (entry.type === 'phase') return ESTIMATED_PHASE_HEIGHT
  if (entry.type === 'placeholder') return 44
  return ESTIMATED_SEPARATOR_HEIGHT
}

const heights = computed(() => entries.value.map((entry) => (
  measuredHeightByKey.value.get(entry.key) ?? getEstimatedHeight(entry)
)))

const restoreTopReserve = computed(() => {
  if (!uiStore.isRestoringUIState) return 0
  return Math.max(viewportHeight.value * 10, 4000)
})

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
  return restoreTopReserve.value + (offsets.value[lastIndex] ?? 0) + (heights.value[lastIndex] ?? 0)
})

const getRenderedTop = (index: number) => restoreTopReserve.value + (offsets.value[index] ?? 0)
const getRenderedBottom = (index: number) => getRenderedTop(index) + (heights.value[index] ?? 0)

const findFirstVisibleIndex = (targetTop: number) => {
  let low = 0
  let high = entries.value.length - 1
  let answer = entries.value.length

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const rowBottom = getRenderedBottom(mid)
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
    const rowTop = getRenderedTop(mid)
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
      top: getRenderedTop(index)
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

const updateViewportMetrics = (persistScroll: boolean = hasInitialAnchorPosition.value) => {
  const container = phaseListRef.value
  if (!container) return
  scrollTop.value = container.scrollTop
  viewportHeight.value = container.clientHeight
  if (persistScroll) {
    uiStore.setColumnScrollTop(props.columnIndex, container.scrollTop)
  }
}

const handleColumnScroll = () => {
  updateViewportMetrics(true)
}

const queueSelectionRealign = (
  behavior: ScrollBehavior = 'smooth',
  delayMs: number = 90,
  direction: 'forward' | 'backward' | 'preserve' = selectionTravelDirection.value
) => {
  if (uiStore.isRestoringUIState) return
  if (pendingSelectionRealignTimeout.value !== null) {
    window.clearTimeout(pendingSelectionRealignTimeout.value)
  }

  pendingSelectionRealignTimeout.value = window.setTimeout(() => {
    pendingSelectionRealignTimeout.value = null
    void scrollSelectedEntryIntoView(behavior, direction)
  }, delayMs)
}

const adjustScrollForHeightChange = (entryIndex: number, delta: number) => {
  const container = phaseListRef.value
  if (!container || delta === 0) return
  const selectedEntryIndex = getSelectedEntryIndexInColumn()
  if (selectedEntryIndex < 0 || entryIndex >= selectedEntryIndex) return
  container.scrollTop += delta
  updateViewportMetrics(true)
  if (!uiStore.isRestoringUIState) {
    queueSelectionRealign('smooth')
  }
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
  const entry = entryIndex >= 0 ? entries.value[entryIndex] : undefined
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
  if (!container) return

  const entryIndex = getSelectedEntryIndexInColumn()
  if (entryIndex < 0) return

  const targetTop = uiStore.isRestoringUIState
    ? Math.max(0, getRenderedTop(entryIndex) - container.clientHeight * 0.25 + (heights.value[entryIndex] ?? 0) * 0.5)
    : Math.max(
        0,
        getRenderedTop(entryIndex) - container.clientHeight * 0.25 + (heights.value[entryIndex] ?? 0) * 0.5
      )

  container.scrollTop = targetTop
  hasInitialAnchorPosition.value = true
  updateViewportMetrics(true)
  if (!uiStore.isRestoringUIState) {
    queueSelectionRealign('smooth', 120, selectionTravelDirection.value)
  }
}

const scrollSelectedEntryIntoView = async (
  behavior: ScrollBehavior = 'smooth',
  direction: 'forward' | 'backward' | 'preserve' = selectionTravelDirection.value
) => {
  await nextTick()
  const selectedEntry = getSelectedEntry()
  if (!selectedEntry) return

  const entryIndex = entries.value.findIndex((entry) => entry.key === selectedEntry.key)
  if (entryIndex < 0 || !phaseListRef.value) return

  const container = phaseListRef.value
  const top = getRenderedTop(entryIndex)
  const height = heights.value[entryIndex] ?? 0
  const bottom = top + height
  const viewTop = container.scrollTop
  const viewport = container.clientHeight
  const viewBottom = viewTop + viewport
  const edgePadding = viewport * EDGE_PADDING_RATIO
  const topAligned = Math.max(0, top - edgePadding)
  const bottomAligned = Math.max(0, bottom - (viewport - edgePadding))
  const pageStep = viewport * PAGE_STEP_RATIO
  const snapThreshold = viewport * SNAP_THRESHOLD_RATIO

  const scrollToClamped = (targetTop: number, scrollBehavior: ScrollBehavior) => {
    const maxScrollTop = Math.max(0, container.scrollHeight - viewport)
    container.scrollTo({
      top: Math.max(0, Math.min(targetTop, maxScrollTop)),
      behavior: scrollBehavior
    })
  }

  if (direction === 'forward') {
    if (top < viewTop + edgePadding || top >= viewBottom) {
      scrollToClamped(topAligned, behavior)
      return
    }

    if (bottom > viewBottom - edgePadding) {
      const remainingToBottomAlign = bottomAligned - viewTop
      const targetTop = remainingToBottomAlign <= snapThreshold
        ? bottomAligned
        : viewTop + pageStep
      scrollToClamped(targetTop, behavior)
      return
    }

    return
  }

  if (direction === 'backward') {
    if (bottom > viewBottom - edgePadding || bottom <= viewTop) {
      scrollToClamped(bottomAligned, behavior)
      return
    }

    if (top < viewTop + edgePadding) {
      const remainingToTopAlign = viewTop - topAligned
      const targetTop = remainingToTopAlign <= snapThreshold
        ? topAligned
        : viewTop - pageStep
      scrollToClamped(targetTop, behavior)
      return
    }

    return
  }

  if (top < viewTop + edgePadding) {
    scrollToClamped(topAligned, behavior)
    return
  }

  if (bottom > viewBottom - edgePadding) {
    scrollToClamped(bottomAligned, behavior)
    return
  }

  if (top < viewTop || bottom > viewBottom) {
    if (uiStore.isRestoringUIState) {
      scrollToClamped(topAligned, 'auto')
      return
    }

    const element = entryElements.value.get(selectedEntry.key)
    if (element) {
      handleScrollRequest(element)
    }
  }
}

// Handle scroll requests from child components
const { handleScrollRequest } = useScrollIntoView(phaseListRef)

const updateRevealedPlaceholder = async () => {
  const selectedEntry = getSelectedEntry()
  if (!selectedEntry || selectedEntry.type !== 'placeholder') {
    revealedPlaceholderKey.value = null
    return
  }

  revealedPlaceholderKey.value = null
  await nextTick()
  revealedPlaceholderKey.value = selectedEntry.key
}

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
  () => {
    const selectedEntry = getSelectedEntry()
    return [
      props.selectedPhaseIndex,
      selectedEntry?.key ?? '',
      props.isSelected,
      entries.value.map((entry) => entry.key).join('|')
    ] as const
  },
  ([selectedPhaseIndex, selectedEntryKey], previousValue) => {
    const previousSelectedPhaseIndex = previousValue?.[0] ?? selectedPhaseIndex
    const previousSelectedEntryKey = previousValue?.[1] ?? selectedEntryKey

    if (selectedEntryKey && previousSelectedEntryKey && selectedEntryKey !== previousSelectedEntryKey) {
      const currentSelectableEntries = selectableEntries.value
      const currentSelectedIndex = currentSelectableEntries.findIndex((entry) => entry.key === selectedEntryKey)
      const previousSelectedIndex = currentSelectableEntries.findIndex((entry) => entry.key === previousSelectedEntryKey)

      if (currentSelectedIndex >= 0 && previousSelectedIndex >= 0) {
        selectionTravelDirection.value = currentSelectedIndex > previousSelectedIndex ? 'forward' : 'backward'
      } else if (selectedPhaseIndex !== previousSelectedPhaseIndex) {
        selectionTravelDirection.value = selectedPhaseIndex > previousSelectedPhaseIndex ? 'forward' : 'backward'
      } else {
        selectionTravelDirection.value = 'preserve'
      }
    } else if (!previousValue) {
      selectionTravelDirection.value = 'preserve'
    }

    void updateRevealedPlaceholder()
    if (!hasInitialAnchorPosition.value) {
      void setInitialAnchorScrollIfNeeded()
      return
    }
    void scrollSelectedEntryIntoView(
      uiStore.isRestoringUIState ? 'auto' : 'smooth',
      selectionTravelDirection.value
    )
  },
  { flush: 'post' }
)

watch(() => entries.value.map((entry) => entry.key).join('|'), async () => {
  if (entries.value.length === 0) {
    hasInitialAnchorPosition.value = false
  }
  await nextTick()
  updateViewportMetrics(false)
}, { flush: 'post' })

onMounted(() => {
  updateViewportMetrics(false)
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
  void updateRevealedPlaceholder()
  void setInitialAnchorScrollIfNeeded()
})

onBeforeUnmount(() => {
  if (pendingSelectionRealignTimeout.value !== null) {
    window.clearTimeout(pendingSelectionRealignTimeout.value)
    pendingSelectionRealignTimeout.value = null
  }
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
      @scroll="handleColumnScroll"
    >
      <div class="virtual-column-space" :style="{ height: `${totalHeight}px` }">
        <template v-for="entry in visibleEntries" :key="entry.key">
        <div
          :ref="(element) => setEntryElement(entry.key, element)"
          class="entry-shell virtual-entry"
          :class="{
            'separator-entry': entry.type === 'separator',
            'placeholder-entry': entry.type === 'placeholder',
            'phase-entry': entry.type === 'phase'
          }"
          :style="{ transform: `translateY(${entry.top}px)` }"
        >
          <div
            v-if="entry.type === 'separator'"
            class="separator-line"
          ></div>
          <div
            v-else-if="entry.type === 'placeholder'"
            class="column-placeholder"
            :class="{
              'selected-item': getSelectableIndex(entry.key) === selectedPhaseIndex,
              'active-item': getSelectableIndex(entry.key) === selectedPhaseIndex && uiStore.activeColumn === columnIndex
            }"
            @click="() => uiStore.selectPhase(columnIndex, getSelectableIndex(entry.key))"
          >
            <span
              class="placeholder-text"
              :class="{
                'is-visible': getSelectableIndex(entry.key) === selectedPhaseIndex && revealedPlaceholderKey === entry.key
              }"
            >
              no sub phases yet. press 'o' to create one
            </span>
          </div>
          <PhaseComponent
            v-else
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

.entry-shell {
  box-sizing: border-box;
  padding: 0.25rem 0;
}

.separator-entry {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
}

.separator-line {
  width: 100%;
  border-top: 1px solid #555;
}

.column-placeholder {
  box-sizing: border-box;
  min-height: 2.5rem;
  padding: 0.75rem;
  border: 1px dashed #555;
  border-radius: 0.25rem;
  color: #888;
  font-style: italic;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.placeholder-text {
  opacity: 0;
  transition: opacity 140ms ease;
  pointer-events: none;
}

.placeholder-text.is-visible {
  opacity: 1;
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
