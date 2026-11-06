<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useUIModalStore } from '../stores/ui/modal-store'
import { contentRect, selectedIdeaRow, useColumnScroll, type FocusRect } from '../composables/useColumnScroll'
import { useKeepSelectedIdeaVisible } from '../composables/useKeepSelectedIdeaVisible'
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
const modalStore = useUIModalStore()

const phaseListRef = ref<HTMLElement | null>(null)
const virtualSpaceRef = ref<HTMLElement | null>(null)
const entryElements = ref(new Map<string, HTMLElement>())
const measuredHeightByKey = ref(new Map<string, number>())
const scrollTop = ref(0)
const viewportHeight = ref(0)
const resizeObserver = ref<ResizeObserver | null>(null)
const revealedPlaceholderKey = ref<string | null>(null)
// Last selection the column acted on; transient gaps never overwrite it.
let settledSelection: { index: number; key: string; isSelected: boolean } | null = null

const handleIdeaClicked = (columnIndex: number, phaseId: string | undefined, ideaId: string, mods?: { ctrl: boolean; shift: boolean }) => {
  const isCtrl = !!(mods && mods.ctrl)
  const isShift = !!(mods && mods.shift)
  const isModeToggle = uiStore.multiSelectMode && !isShift
  if (isCtrl || isModeToggle) {
    uiStore.toggleMultiSelect(ideaId)
  } else if (isShift) {
    if (phaseId) {
      const ordered = dataStore.getIdeasForPhase(phaseId).map((a: any) => a.id)
      if (ordered.includes(ideaId)) {
        uiStore.selectMultiRange(ideaId, ordered)
      }
      // subs: range already done in IdeasList handler; no extra toggle
    } else {
      uiStore.toggleMultiSelect(ideaId)
    }
  } else {
    uiStore.clearMultiSelect()
  }
  if ((isCtrl || isShift || isModeToggle) && uiStore.getCurrentIdea()?.id === ideaId) return
  // Always update primary nav selection (so keyboard etc still work on it)
  uiStore.selectIdeaById(columnIndex, phaseId, ideaId).catch(() => {})
}

const ESTIMATED_PHASE_HEIGHT = 180
const ESTIMATED_SEPARATOR_HEIGHT = 17
const OVERSCAN_COUNT = 4

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

const getRenderedTop = (index: number) => offsets.value[index] ?? 0
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

const selectableIndexByKey = computed(() => new Map(
  selectableEntries.value.map((entry, index) => [entry.key, index])
))

const getSelectableIndex = (entryKey: string) => selectableIndexByKey.value.get(entryKey) ?? -1

// Touch affordance: tapping an empty child-slot placeholder selects it and opens
// the phase creation modal — the click equivalent of pressing 'o'.
const createPhaseAtPlaceholder = async (entryKey: string) => {
  await uiStore.selectPhase(props.columnIndex, getSelectableIndex(entryKey))
  modalStore.openPhaseModal('after')
}

// Tapping the zero-entry empty column (e.g. a project with no root phases yet)
// focuses the column and opens the creation modal; with no selected entry the
// modal creates a root phase.
const createPhaseInEmptyColumn = () => {
  uiStore.setActiveColumn(props.columnIndex)
  modalStore.openPhaseModal('after')
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

// The column's focus: the selected idea's row while navigating ideas here,
// otherwise the selected entry (from the layout model, so it works before the
// entry is rendered).
const getFocus = (): FocusRect | null => {
  const container = phaseListRef.value
  if (!container) return null
  if (uiStore.navigatingIdeas && uiStore.activeColumn === props.columnIndex) {
    const ideaRow = selectedIdeaRow(container)
    if (ideaRow) return contentRect(container, ideaRow)
  }
  const entryIndex = getSelectedEntryIndexInColumn()
  if (entryIndex < 0) return null
  return { top: (virtualSpaceRef.value?.offsetTop ?? 0) + getRenderedTop(entryIndex), height: heights.value[entryIndex] ?? 0 }
}

const scroll = useColumnScroll(phaseListRef, getFocus, () => uiStore.isRestoringUIState)

useKeepSelectedIdeaVisible(() => uiStore.activeColumn === props.columnIndex, scroll.reveal)

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
  if (entryIndex < 0) return
  // Keep the focus where it is: entries above it move the column with them,
  // the focus itself may now need revealing.
  const selectedIndex = getSelectedEntryIndexInColumn()
  if (entryIndex < selectedIndex) scroll.shift(measuredHeight - previousHeight)
  else if (entryIndex === selectedIndex) scroll.reveal()
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
  if (req && req.col === props.columnIndex) scroll.scrollToEdge(req.direction)
})

// Restoring jumps without animation; once done, the restored focus is revealed.
watch(() => uiStore.isRestoringUIState, (restoring) => {
  if (!restoring) scroll.reveal()
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
  ([selectedPhaseIndex, selectedEntryKey, isSelected]) => {
    // The selected entry is absent mid-move (a parent change arrives as several
    // pushes). Hold everything until it reappears instead of reacting to the gap.
    if (!selectedEntryKey) return

    const settled = settledSelection
    settledSelection = { index: selectedPhaseIndex, key: selectedEntryKey, isSelected }

    // The watch also depends on the entries-key list, so it re-fires whenever
    // entries change. Only treat it as a navigation event — and thus recenter —
    // when the selection identity or position changes or this column just
    // became the focused one. Otherwise we'd yank the view back mid-scroll.
    const keyChanged = !!settled && selectedEntryKey !== settled.key
    const indexChanged = !!settled && selectedPhaseIndex !== settled.index
    // The previous entry vanished (deleted, here or by another client): the
    // selection fell back to a stand-in until whoever removed it reselects.
    // That is not navigation, so don't scroll toward the stand-in.
    const previousRemoved = keyChanged && !selectableEntries.value.some((entry) => entry.key === settled!.key)
    const selectionChanged = !previousRemoved && (keyChanged || indexChanged || (isSelected && !settled?.isSelected))

    void updateRevealedPlaceholder()
    // Don't reveal when the watch only re-fired due to entries churning
    // during a user scroll — that's what was fighting the flick.
    if (!settled || selectionChanged) scroll.reveal()
  },
  { flush: 'post' }
)

watch(() => entries.value.map((entry) => entry.key).join('|'), async () => {
  await nextTick()
  updateViewportMetrics()
}, { flush: 'post' })

onMounted(() => {
  // The selection watch isn't immediate; seed what it compares against so the
  // first change after mounting is judged like any later one.
  const initialKey = getSelectedEntry()?.key
  if (initialKey) {
    settledSelection = { index: props.selectedPhaseIndex, key: initialKey, isSelected: props.isSelected }
  }
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
  void updateRevealedPlaceholder()
  scroll.reveal()
})

onBeforeUnmount(() => {
  resizeObserver.value?.disconnect()
  resizeObserver.value = null
})
</script>

<template>
  <div class="column-panel" :class="{ 'active': isActive, 'selected': isSelected }">
    <div
      v-if="entries.length === 0"
      class="empty-state"
      @click="createPhaseInEmptyColumn"
    >
      No phases yet — tap to create one (or press o)
    </div>

    <div
      v-else
      ref="phaseListRef"
      class="column-list"
      @scroll="updateViewportMetrics"
    >
      <div ref="virtualSpaceRef" class="virtual-column-space" :style="{ height: `${totalHeight}px` }">
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
            @click="() => createPhaseAtPlaceholder(entry.key)"
          >
            <span
              class="placeholder-text"
              :class="{
                'is-visible': getSelectableIndex(entry.key) === selectedPhaseIndex && revealedPlaceholderKey === entry.key
              }"
            >
              no sub phases yet — tap to create one (or 'o')
            </span>
          </div>
          <PhaseComponent
            v-else
            :phase="entry.phase"
            :is-selected="getSelectableIndex(entry.key) === selectedPhaseIndex"
            :is-active="getSelectableIndex(entry.key) === selectedPhaseIndex && uiStore.activeColumn === columnIndex"
            @phase-clicked="() => uiStore.selectPhase(columnIndex, getSelectableIndex(entry.key))"
            @idea-clicked="(ideaId, mods) => handleIdeaClicked(columnIndex, entry.phase.id, ideaId, mods)"
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
  cursor: pointer;
}
</style>
