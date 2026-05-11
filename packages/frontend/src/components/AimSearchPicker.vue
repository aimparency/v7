<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import type { SearchAimResult } from 'shared'
import type { AimSearchAdditionalOption } from '../stores/ui/aim-search-types'

type AimSearchSelection =
  | { type: 'aim'; data: SearchAimResult; keepOpen?: boolean }
  | { type: 'option'; data: AimSearchAdditionalOption; keepOpen?: boolean }
  | null

const props = withDefaults(defineProps<{
  query?: string
  initialQuery?: string
  placeholder?: string
  showInput?: boolean
  showFilters?: boolean
  autofocus?: boolean
  additionalOptions?: AimSearchAdditionalOption[]
  emptyMessage?: string
  selectionBehavior?: 'first' | 'unique-near-exact-aim'
  activateOnClick?: boolean
  activateOnEnter?: boolean
  selectOnHover?: boolean
  resultLimit?: number
}>(), {
  query: undefined,
  initialQuery: '',
  placeholder: 'Search aims...',
  showInput: true,
  showFilters: false,
  autofocus: false,
  additionalOptions: () => [],
  emptyMessage: 'No aims found.',
  selectionBehavior: 'first',
  activateOnClick: true,
  activateOnEnter: true,
  selectOnHover: true,
  resultLimit: 10
})

const emit = defineEmits<{
  (e: 'activate', payload: NonNullable<AimSearchSelection>): void
  (e: 'selection-change', payload: AimSearchSelection): void
  (e: 'escape'): void
}>()

const dataStore = useDataStore()
const projectStore = useProjectStore()

const localQuery = ref(props.initialQuery)
const searchResults = ref<SearchAimResult[]>([])
const selectedIndex = ref(0)
const focusedResultIndex = ref(-1)
const hoveredResultIndex = ref(-1)
const searchInput = ref<HTMLInputElement>()
const resultsListRef = ref<HTMLDivElement>()
const loading = ref(false)
const searchError = ref<string | null>(null)
const selectedStatuses = ref<string[]>([])
const includeArchived = ref(false)
const isStatusDropdownOpen = ref(false)

const availableStatuses = computed(() => dataStore.getStatuses)
const currentQuery = computed(() => (props.query ?? localQuery.value).trim())

const items = computed(() => [
  ...props.additionalOptions
    .filter(option => !option.showWhenQueryEmptyOnly || currentQuery.value.length === 0)
    .map(option => ({ type: 'option' as const, data: option })),
  ...searchResults.value.map(result => ({ type: 'aim' as const, data: result }))
])

const selectedItem = computed<AimSearchSelection>(() => items.value[selectedIndex.value] ?? null)

const toggleStatus = (status: string) => {
  const index = selectedStatuses.value.indexOf(status)
  if (index === -1) {
    selectedStatuses.value.push(status)
  } else {
    selectedStatuses.value.splice(index, 1)
  }
}

const getAimDisplayText = (aim: SearchAimResult): string => {
  const maxLength = 100

  // If aim text is already >= 100 chars, just return it
  if (aim.text.length >= maxLength) {
    return aim.text
  }

  // Build parent path recursively
  const buildPath = (aimId: string, currentPath: string[]): string[] => {
    const currentAim = dataStore.aims[aimId]
    if (!currentAim || !currentAim.supportedAims || currentAim.supportedAims.length === 0) {
      return currentPath
    }

    // Get the first parent (largest/primary parent)
    const parentId = currentAim.supportedAims[0]
    if (!parentId) return currentPath

    const parentAim = dataStore.aims[parentId]
    if (!parentAim) return currentPath

    // Add parent text to the beginning of the path
    const newPath = [parentAim.text, ...currentPath]
    const pathString = newPath.join(' / ')

    // If adding this parent would exceed max length, stop here
    if (pathString.length > maxLength) {
      return currentPath
    }

    // Continue recursively with the parent
    return buildPath(parentId, newPath)
  }

  const path = buildPath(aim.id, [aim.text])

  // If we only have the aim itself (no parents found or they would exceed limit), return just the text
  if (path.length === 1) {
    return aim.text
  }

  return path.join(' / ')
}

const getAimIdRemainder = (aim: SearchAimResult): string => {
  const prefixLength = aim.idMatch?.prefix.length ?? 0
  return aim.id.slice(prefixLength)
}

const normalizeSearchError = (error: any): string => {
  const message = error?.message || error?.shape?.message || error?.data?.message
  if (typeof message === 'string' && message.trim()) {
    return `Search failed: ${message.trim()}`
  }

  return 'Search failed because the server returned an error.'
}

const emitSelectionChange = () => {
  emit('selection-change', selectedItem.value)
}

const applySelectionBehavior = () => {
  if (items.value.length === 0) {
    selectedIndex.value = 0
    focusedResultIndex.value = -1
    emitSelectionChange()
    return
  }

  if (props.selectionBehavior === 'unique-near-exact-aim' && currentQuery.value.length > 0) {
    const normalizedQuery = currentQuery.value.toLowerCase()
    const exactMatches = searchResults.value.flatMap((result, index) => {
      const resultText = result.text.toLowerCase()
      const startsWithMatch = resultText.startsWith(normalizedQuery)
      const thresholdMet = normalizedQuery.length >= resultText.length * 0.9
      return startsWithMatch && thresholdMet ? [index] : []
    })

    if (exactMatches.length === 1) {
      selectedIndex.value = props.additionalOptions.length + exactMatches[0]!
      focusedResultIndex.value = -1
      emitSelectionChange()
      return
    }
  }

  selectedIndex.value = 0
  focusedResultIndex.value = -1
  emitSelectionChange()
}

const performSearch = async (query: string) => {
  if (!query) {
    searchResults.value = []
    searchError.value = null
    loading.value = false
    applySelectionBehavior()
    return
  }

  loading.value = true
  searchError.value = null

  try {
    const [keywordResults, semanticResults] = await Promise.all([
      trpc.aim.search.query({
        projectPath: projectStore.projectPath,
        query,
        limit: props.resultLimit,
        status: selectedStatuses.value.length > 0 ? selectedStatuses.value : undefined,
        archived: includeArchived.value
      }),
      trpc.aim.searchSemantic.query({
        projectPath: projectStore.projectPath,
        query,
        limit: props.resultLimit * 3,
        status: selectedStatuses.value.length > 0 ? selectedStatuses.value : undefined
      })
    ])

    const combined = new Map<string, SearchAimResult>()

    semanticResults.forEach(result => {
      combined.set(result.id, { ...result })
    })

    keywordResults.forEach(result => {
      const existing = combined.get(result.id)
      if (existing) {
        const semanticScore = existing.score || 0
        const keywordScore = result.score || 0
        existing.score = Math.max(semanticScore, keywordScore) + 0.2
        if (result.idMatch) {
          existing.idMatch = result.idMatch
        }
      } else {
        combined.set(result.id, { ...result })
      }
    })

    searchResults.value = Array.from(combined.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, props.resultLimit)
  } catch (error: any) {
    console.error('Aim search failed:', error)
    searchResults.value = []
    searchError.value = normalizeSearchError(error)
  } finally {
    loading.value = false
    applySelectionBehavior()
  }
}

let searchTimeout: NodeJS.Timeout | undefined

const scheduleSearch = (query: string) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    void performSearch(query.trim())
  }, 150)
}

watch(
  () => currentQuery.value,
  query => {
    scheduleSearch(query)
  },
  { immediate: true }
)

watch([selectedStatuses, includeArchived], () => {
  scheduleSearch(currentQuery.value)
}, { deep: true })

watch(() => props.additionalOptions, () => {
  applySelectionBehavior()
}, { deep: true })

watch(selectedIndex, () => {
  emitSelectionChange()
})

const setSelectedIndex = (index: number) => {
  if (index < 0 || index >= items.value.length) return
  selectedIndex.value = index
}

const scrollToItem = (index: number) => {
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[index]
    if (typeof item?.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  })
}

const focusResult = (index: number) => {
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[index]
    item?.focus()
    if (typeof item?.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  })
}

const activateSelection = (selection: AimSearchSelection = selectedItem.value, keepOpen = false) => {
  if (!selection) return
  emit('activate', keepOpen ? { ...selection, keepOpen } : selection)
}

const getEscapeSelection = (): NonNullable<AimSearchSelection> | null => {
  const escapeOption = props.additionalOptions.find(option => option.actsAsEscape)
  return escapeOption ? { type: 'option', data: escapeOption } : null
}

const handleEscape = () => {
  const escapeSelection = getEscapeSelection()
  if (escapeSelection) {
    activateSelection(escapeSelection)
  } else {
    emit('escape')
  }
}

const handleInputKeydown = (event: KeyboardEvent) => {
  const key = event.key
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(key)) {
    return
  }

  if (key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    handleEscape()
    return
  }

  if (key === 'Tab') {
    if (items.value.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    focusedResultIndex.value = selectedIndex.value
    focusResult(selectedIndex.value)
    return
  }

  if (items.value.length === 0) {
    if (key === 'Enter' && props.activateOnEnter) {
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }

  if (key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    const nextIndex = Math.min(selectedIndex.value + 1, items.value.length - 1)
    setSelectedIndex(nextIndex)
    scrollToItem(nextIndex)
    return
  }

  if (key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const nextIndex = Math.max(selectedIndex.value - 1, 0)
    setSelectedIndex(nextIndex)
    scrollToItem(nextIndex)
    return
  }

  if (key === 'Enter' && props.activateOnEnter) {
    event.preventDefault()
    event.stopPropagation()
    activateSelection(selectedItem.value, event.shiftKey)
  }
}

const handleResultClick = (index: number) => {
  setSelectedIndex(index)
  focusedResultIndex.value = index
  if (props.activateOnClick) {
    activateSelection(items.value[index] ?? null)
  }
}

const handleResultKeydown = (event: KeyboardEvent, index: number) => {
  const key = event.key
  if (!['ArrowDown', 'ArrowUp', 'j', 'k', 'Enter', 'Escape', 'Tab'].includes(key)) {
    return
  }

  if (key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    handleEscape()
    return
  }

  if (key === 'Tab') {
    focusedResultIndex.value = -1
    if (props.showInput) {
      event.preventDefault()
      event.stopPropagation()
      focusInput()
    }
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (key === 'ArrowDown' || key === 'j') {
    const nextIndex = Math.min(index + 1, items.value.length - 1)
    setSelectedIndex(nextIndex)
    focusedResultIndex.value = nextIndex
    focusResult(nextIndex)
    return
  }

  if (key === 'ArrowUp' || key === 'k') {
    const nextIndex = Math.max(index - 1, 0)
    setSelectedIndex(nextIndex)
    focusedResultIndex.value = nextIndex
    focusResult(nextIndex)
    return
  }

  if (key === 'Enter') {
    activateSelection(items.value[index] ?? null, event.shiftKey)
  }
}

const getResultTabIndex = (index: number) => {
  if (focusedResultIndex.value >= 0) {
    return index === focusedResultIndex.value ? 0 : -1
  }

  if (!props.showInput) {
    return index === selectedIndex.value ? 0 : -1
  }

  return -1
}

const handleResultMouseEnter = (index: number) => {
  hoveredResultIndex.value = index
  if (props.selectOnHover) {
    setSelectedIndex(index)
  }
}

const handleResultMouseLeave = (index: number) => {
  if (hoveredResultIndex.value === index) {
    hoveredResultIndex.value = -1
  }
}

const focusInput = () => {
  searchInput.value?.focus()
}

const focusSelectedResult = () => {
  if (items.value.length === 0) return
  focusedResultIndex.value = selectedIndex.value
  focusResult(selectedIndex.value)
}

defineExpose({
  activateSelection,
  focusInput,
  focusSelectedResult
})

onMounted(() => {
  if (props.autofocus && props.showInput) {
    nextTick(() => focusInput())
  }
})

onUnmounted(() => {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
})
</script>

<template>
  <div class="aim-search-picker">
    <div v-if="showFilters" class="filter-bar">
      <div class="filter-group relative">
        <button
          @click="isStatusDropdownOpen = !isStatusDropdownOpen"
          class="filter-btn"
          :class="{ active: selectedStatuses.length > 0 || isStatusDropdownOpen }"
        >
          Status {{ selectedStatuses.length > 0 ? `(${selectedStatuses.length})` : '' }} ▼
        </button>

        <div v-if="isStatusDropdownOpen" class="dropdown-overlay" @click="isStatusDropdownOpen = false"></div>

        <div v-if="isStatusDropdownOpen" class="dropdown-menu">
          <div
            v-for="status in availableStatuses"
            :key="status.key"
            class="dropdown-item"
            @click.stop="toggleStatus(status.key)"
          >
            <input type="checkbox" :checked="selectedStatuses.includes(status.key)" readonly />
            <span :style="{ color: status.color }">{{ status.key }}</span>
          </div>
        </div>
      </div>

      <div class="filter-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="includeArchived" />
          <span>Archived</span>
        </label>
      </div>
    </div>

    <div v-if="showInput" class="search-input-wrapper">
      <span class="search-icon">/</span>
      <input
        ref="searchInput"
        v-model="localQuery"
        type="text"
        :placeholder="placeholder"
        @keydown="handleInputKeydown"
      />
      <div v-if="loading" class="loader">...</div>
    </div>

    <div
      v-if="items.length > 0 || searchError || (currentQuery && !loading)"
      ref="resultsListRef"
      class="results-list"
    >
      <div v-if="items.length > 0">
        <div
          v-for="(item, index) in items"
          :key="item.type === 'option' ? `option-${item.data.id}` : item.data.id"
          class="result-item"
          :class="{
            selected: index === selectedIndex,
            hovered: !props.selectOnHover && index === hoveredResultIndex,
            'additional-option': item.type === 'option'
          }"
          :tabindex="getResultTabIndex(index)"
          @click="handleResultClick(index)"
          @mouseenter="handleResultMouseEnter(index)"
          @mouseleave="handleResultMouseLeave(index)"
          @focus="focusedResultIndex = index"
          @keydown="handleResultKeydown($event, index)"
        >
          <template v-if="item.type === 'option'">
            <div class="result-text option-text">
              <span class="aim-text">{{ item.data.label }}</span>
              <span v-if="item.data.description" class="option-description">{{ item.data.description }}</span>
            </div>
          </template>

          <template v-else>
            <div class="result-content">
              <div class="result-text">
                <span class="aim-text">{{ getAimDisplayText(item.data) }}</span>
                <span class="aim-status" :class="item.data.status.state">{{ item.data.status.state }}</span>
              </div>
              <div v-if="item.data.idMatch" class="aim-id-match">
                <span class="aim-id-prefix">{{ item.data.idMatch.prefix }}</span><span>{{ getAimIdRemainder(item.data) }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-else-if="searchError" class="search-feedback search-error">
        {{ searchError }}
      </div>

      <div v-else class="search-feedback no-results">
        {{ emptyMessage }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.aim-search-picker {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.filter-bar {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #333;
  background: #1e1e1e;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.relative {
  position: relative;
}

.filter-btn {
  padding: 0.35rem 0.6rem;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #ddd;
  border-radius: 0.25rem;
  cursor: pointer;
}

.filter-btn.active {
  border-color: #007acc;
}

.dropdown-overlay {
  position: fixed;
  inset: 0;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  min-width: 12rem;
  background: #252526;
  border: 1px solid #444;
  border-radius: 0.35rem;
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.35);
  z-index: 10;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  cursor: pointer;
}

.dropdown-item:hover {
  background: #2f2f2f;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #d0d0d0;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #333;
  background: #1e1e1e;
}

.search-icon {
  margin-right: 0.65rem;
  color: #888;
}

.search-input-wrapper input {
  width: 100%;
  padding: 0;
  background: transparent;
  border: none;
  color: #f3f3f3;
  font-size: 1rem;
}

.search-input-wrapper input:focus {
  outline: none;
}

.loader {
  margin-left: 0.75rem;
  color: #888;
}

.results-list {
  overflow-y: auto;
  max-height: 22rem;
}

.result-item {
  padding: 0.8rem 1rem;
  border-bottom: 1px solid #2d2d2d;
  cursor: pointer;
}

.result-item.selected {
  background: #094771;
}

.result-item.additional-option {
  border-bottom-color: #3a3220;
}

.result-text {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.result-content {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.option-text {
  flex-direction: column;
  gap: 0.2rem;
}

.aim-text {
  color: #f0f0f0;
}

.aim-id-match {
  color: #8c8c8c;
  font-family: monospace;
  font-size: 0.78rem;
  line-height: 1.2;
}

.aim-id-prefix {
  color: #33d6ff;
  font-weight: 700;
}

.option-description {
  color: #a6a6a6;
  font-size: 0.85rem;
}

.aim-status {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #bbb;
}

.search-feedback {
  padding: 1rem;
  color: #aaa;
}

.search-error {
  color: #ff9a9a;
}
</style>
