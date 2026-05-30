<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import type { SearchAimResult } from 'shared'
import type { AimSearchAdditionalOption } from '../stores/ui/aim-search-types'

export type AimSearchSelection =
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
  externalResults?: SearchAimResult[]
  navigationTitle?: string
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
  resultLimit: 10,
  externalResults: undefined,
  navigationTitle: ''
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
const navigationMode = ref(false)
const localNavigationTitle = ref('')
const navigationHistory = ref<{ title: string, results: SearchAimResult[] }[]>([])
const selectedIndex = ref(0)
const searchInput = ref<HTMLInputElement>()
const resultsListRef = ref<HTMLDivElement>()
const loading = ref(false)
const searchError = ref<string | null>(null)
const selectedStatuses = ref<string[]>([])
const includeArchived = ref(false)
const isStatusDropdownOpen = ref(false)

const availableStatuses = computed(() => dataStore.getStatuses)
const currentQuery = computed(() => (props.query ?? localQuery.value).trim())
const displayTitle = computed(() => props.navigationTitle || localNavigationTitle.value)

const items = computed(() => {
  if (!navigationMode.value && props.externalResults) {
    return props.externalResults.map(result => ({ type: 'aim' as const, data: result }))
  }

  return [
    ...props.additionalOptions
      .filter(option => !option.showWhenQueryEmptyOnly || currentQuery.value.length === 0)
      .map(option => ({ type: 'option' as const, data: option })),
    ...searchResults.value.map(result => ({ type: 'aim' as const, data: result }))
  ]
})

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
  if (aim.text.length >= maxLength) return aim.text

  const buildPath = (aimId: string, currentPath: string[]): string[] => {
    const currentAim = dataStore.aims[aimId]
    if (!currentAim || !currentAim.supportedAims?.length) return currentPath

    const parentId = currentAim.supportedAims[0]
    const parentAim = parentId ? dataStore.aims[parentId] : null
    if (!parentAim) return currentPath

    const newPath = [parentAim.text, ...currentPath]
    if (newPath.join(' / ').length > maxLength) return currentPath
    return buildPath(parentId!, newPath)
  }

  const path = buildPath(aim.id, [aim.text])
  return path.length === 1 ? aim.text : path.join(' / ')
}

const getAimIdRemainder = (aim: SearchAimResult): string => {
  const prefixLength = aim.idMatch?.prefix.length ?? 0
  return aim.id.slice(prefixLength)
}

const emitSelectionChange = () => {
  emit('selection-change', selectedItem.value)
}

const applySelectionBehavior = () => {
  if (items.value.length === 0) {
    selectedIndex.value = 0
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
      emitSelectionChange()
      return
    }
  }

  selectedIndex.value = 0
  emitSelectionChange()
}

const performSearch = async (query: string) => {
  if (navigationMode.value || props.externalResults) return

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
    semanticResults.forEach(result => combined.set(result.id, { ...result }))
    keywordResults.forEach(result => {
      const existing = combined.get(result.id)
      if (existing) {
        existing.score = Math.max(existing.score || 0, result.score || 0) + 0.2
        if (result.idMatch) existing.idMatch = result.idMatch
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
    searchError.value = `Search failed: ${error.message || error}`
  } finally {
    loading.value = false
    applySelectionBehavior()
  }
}

let searchTimeout: NodeJS.Timeout | undefined
const scheduleSearch = (query: string) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => void performSearch(query.trim()), 150)
}

watch([() => currentQuery.value, () => includeArchived.value, () => selectedStatuses.value.length], ([query]) => {
  if (navigationMode.value && query.length > 0) {
    navigationMode.value = false
    navigationHistory.value = []
  }
  scheduleSearch(query)
}, { immediate: true })

const navigateToParents = async (aim: SearchAimResult, wasFocused = false) => {
  if (!aim.supportedAims?.length) return
  loading.value = true
  try {
    const parents = await trpc.aim.getMany.query({ projectPath: projectStore.projectPath, aimIds: aim.supportedAims })
    navigationHistory.value.push({ title: localNavigationTitle.value || 'Search Results', results: [...searchResults.value] })
    searchResults.value = parents.map(p => ({ ...p, score: 1 }))
    localNavigationTitle.value = `Parents of: ${aim.text}`
    navigationMode.value = true
    selectedIndex.value = props.additionalOptions.length
    applySelectionBehavior()
    if (wasFocused) nextTick(() => focusSelectedResult())
  } finally {
    loading.value = false
  }
}

const navigateToChildren = async (aim: SearchAimResult, wasFocused = false) => {
  loading.value = true
  try {
    const children = await trpc.aim.list.query({ projectPath: projectStore.projectPath, parentAimId: aim.id })
    if (children.length === 0) return
    navigationHistory.value.push({ title: localNavigationTitle.value || 'Search Results', results: [...searchResults.value] })
    searchResults.value = children.map(c => ({ ...c, score: 1 }))
    localNavigationTitle.value = `Children of: ${aim.text}`
    navigationMode.value = true
    selectedIndex.value = props.additionalOptions.length
    applySelectionBehavior()
    if (wasFocused) nextTick(() => focusSelectedResult())
  } finally {
    loading.value = false
  }
}

const navigateBack = (wasFocused = false) => {
  const previous = navigationHistory.value.pop()
  if (previous) {
    searchResults.value = previous.results
    localNavigationTitle.value = previous.title === 'Search Results' ? '' : previous.title
    if (navigationHistory.value.length === 0) navigationMode.value = false
    applySelectionBehavior()
    if (wasFocused) nextTick(() => focusSelectedResult())
  } else {
    navigationMode.value = false
  }
}

const scrollToItem = (index: number) => {
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[index]
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  })
}

const activateSelection = (selection: AimSearchSelection = selectedItem.value, keepOpen = false) => {
  if (!selection) return
  emit('activate', keepOpen ? { ...selection, keepOpen } : selection)
}

const handleKeydown = (event: KeyboardEvent) => {
  const key = event.key
  const isInput = event.target instanceof HTMLInputElement

  if (key === 'Escape') {
    event.preventDefault()
    if (navigationMode.value) {
      event.stopPropagation()
      navigateBack(!isInput)
    } else {
      emit('escape')
    }
    return
  }

  if (key === 'ArrowDown' || (key === 'j' && !isInput)) {
    event.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, items.value.length - 1)
    focusSelectedResult()
    return
  }

  if (key === 'ArrowUp' || (key === 'k' && !isInput)) {
    event.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    focusSelectedResult()
    return
  }

  if (key === 'h' && (!isInput || currentQuery.value.length === 0)) {
    event.preventDefault()
    const item = selectedItem.value
    if (item?.type === 'aim' && item.data.supportedAims?.length) {
      void navigateToParents(item.data, true)
    } else if (navigationMode.value) {
      navigateBack(true)
    }
    return
  }

  if (key === 'l' && (!isInput || currentQuery.value.length === 0)) {
    event.preventDefault()
    const item = selectedItem.value
    if (item?.type === 'aim' && item.data.supportingConnections?.length) {
      void navigateToChildren(item.data, true)
    }
    return
  }

  if (key === 'Backspace' && !isInput) {
    event.preventDefault()
    if (navigationMode.value) {
      event.stopPropagation()
      navigateBack(true)
    } else {
      emit('escape')
    }
    return
  }

  if (key === 'Enter') {
    event.preventDefault()
    activateSelection(selectedItem.value, event.shiftKey)
  }

  if (key === 'Tab' && isInput && items.value.length > 0) {
    event.preventDefault()
    focusSelectedResult()
  }
}

const focusInput = () => searchInput.value?.focus()

const focusSelectedResult = () => {
  scrollToItem(selectedIndex.value)
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[selectedIndex.value]
    if (item && typeof item.focus === 'function') {
      item.focus()
    }
  })
}

const navigate = (delta: number) => {
  selectedIndex.value = Math.max(0, Math.min(selectedIndex.value + delta, items.value.length - 1))
  focusSelectedResult()
}

defineExpose({ activateSelection, focusInput, focusSelectedResult, navigate })

onMounted(() => {
  if (props.autofocus && props.showInput) nextTick(() => focusInput())
})

onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
})
</script>

<template>
  <div class="aim-search-picker" @keydown="handleKeydown">
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
          <div v-for="status in availableStatuses" :key="status.key" class="dropdown-item" @click.stop="toggleStatus(status.key)">
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

    <div v-if="displayTitle" class="navigation-header">
      <span class="back-hint">← H</span>
      <span class="nav-title">{{ displayTitle }}</span>
    </div>

    <div v-if="showInput" class="search-input-wrapper">
      <span class="search-icon">/</span>
      <input ref="searchInput" v-model="localQuery" type="text" :placeholder="placeholder" />
      <div v-if="loading" class="loader">...</div>
    </div>

    <div v-if="items.length > 0 || searchError || (currentQuery && !loading)" ref="resultsListRef" class="results-list">
      <div v-if="items.length > 0" class="results-scroll" tabindex="-1">
        <div
          v-for="(item, index) in items"
          :key="item.type === 'option' ? `option-${item.data.id}` : item.data.id"
          class="result-item"
          :class="{ selected: index === selectedIndex, 'additional-option': item.type === 'option' }"
          :tabindex="index === selectedIndex ? 0 : -1"
          @click="selectedIndex = index; props.activateOnClick && activateSelection(item)"
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
                <div class="aim-meta">
                  <span v-if="item.data.supportedAims?.length" class="nav-indicator">H ←</span>
                  <span class="aim-status" :class="item.data.status.state">{{ item.data.status.state }}</span>
                  <span v-if="item.data.supportingConnections?.length" class="nav-indicator">→ L</span>
                </div>
              </div>
              <div v-if="item.data.idMatch" class="aim-id-match">
                <span class="aim-id-prefix">{{ item.data.idMatch.prefix }}</span><span>{{ getAimIdRemainder(item.data) }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
      <div v-else-if="searchError" class="search-feedback search-error">{{ searchError }}</div>
      <div v-else class="search-feedback no-results">{{ emptyMessage }}</div>
    </div>
  </div>
</template>

<style scoped>
.navigation-header {
  display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem;
  background: #2d2d2d; border-bottom: 1px solid #333; color: #ccc; font-size: 0.85rem;
}
.back-hint { padding: 0.1rem 0.3rem; background: #444; border-radius: 0.2rem; font-family: monospace; font-weight: bold; }
.nav-title { font-weight: 500; color: #eee; }
.aim-search-picker { display: flex; flex-direction: column; min-height: 0; }
.filter-bar { display: flex; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid #333; background: #1e1e1e; }
.filter-group { display: flex; align-items: center; gap: 0.5rem; }
.relative { position: relative; }
.filter-btn { padding: 0.35rem 0.6rem; background: #2a2a2a; border: 1px solid #444; color: #ddd; border-radius: 0.25rem; cursor: pointer; }
.filter-btn.active { border-color: #007acc; }
.dropdown-overlay { position: fixed; inset: 0; }
.dropdown-menu {
  position: absolute; top: calc(100% + 0.4rem); left: 0; min-width: 12rem;
  background: #252526; border: 1px solid #444; border-radius: 0.35rem; box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.35); z-index: 10;
}
.dropdown-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.65rem; cursor: pointer; }
.dropdown-item:hover { background: #2f2f2f; }
.checkbox-label { display: flex; align-items: center; gap: 0.4rem; color: #d0d0d0; }
.search-input-wrapper { display: flex; align-items: center; padding: 0.85rem 1rem; border-bottom: 1px solid #333; background: #1e1e1e; }
.search-icon { margin-right: 0.65rem; color: #888; }
.search-input-wrapper input { width: 100%; padding: 0; background: transparent; border: none; color: #f3f3f3; font-size: 1rem; }
.search-input-wrapper input:focus { outline: none; }
.loader { margin-left: 0.75rem; color: #888; }
.results-list { }
.results-scroll { overflow-y: auto; max-height: 22rem; }
.result-item { padding: 0.8rem 1rem; border-bottom: 1px solid #2d2d2d; cursor: pointer; }
.result-item.selected { background: #094771; outline: 1px solid #007acc; outline-offset: -1px; }
.result-item.additional-option { border-bottom-color: #3a3220; }
.result-text { display: flex; justify-content: space-between; gap: 1rem; }
.result-content { display: flex; flex-direction: column; gap: 0.35rem; }
.option-text { flex-direction: column; gap: 0.2rem; }
.aim-text { color: #f0f0f0; }
.aim-meta { display: flex; align-items: center; gap: 0.6rem; }
.nav-indicator { font-size: 0.7rem; color: #666; background: #2a2a2a; padding: 0.1rem 0.3rem; border-radius: 0.2rem; font-family: monospace; }
.aim-id-match { color: #8c8c8c; font-family: monospace; font-size: 0.78rem; line-height: 1.2; }
</style>
