<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import type { Phase } from 'shared'
import { timestampToLocalDate } from 'shared'
import type { PhaseSearchAdditionalOption, PhaseSearchSelection } from '../stores/ui/phase-search-types'

const projectStore = useProjectStore()

const props = withDefaults(defineProps<{
  excludePhaseId?: string | null
  title?: string
  placeholder?: string
  additionalOptions?: PhaseSearchAdditionalOption[]
}>(), {
  excludePhaseId: null,
  title: 'Search Phases',
  placeholder: 'Search phases...',
  additionalOptions: () => []
})

const emit = defineEmits<{
  (e: 'select', payload: PhaseSearchSelection): void
  (e: 'close'): void
}>()

const searchQuery = ref('')
const searchResults = ref<Phase[]>([])
const selectedIndex = ref(0)
const focusedResultIndex = ref(-1)
const searchInput = ref<HTMLInputElement>()
const resultsListRef = ref<HTMLDivElement>()
const loading = ref(false)

const items = computed(() => [
  ...props.additionalOptions
    .filter(option => !option.showWhenQueryEmptyOnly || searchQuery.value.trim().length === 0)
    .map(option => ({ type: 'option' as const, data: option })),
  ...searchResults.value.map(phase => ({ type: 'phase' as const, data: phase }))
])

const performSearch = async (query: string) => {
  loading.value = true
  try {
    let results = await trpc.phase.search.query({
      projectPath: projectStore.projectPath,
      query
    })

    if (props.excludePhaseId) {
      results = results.filter(phase => phase.id !== props.excludePhaseId)
    }

    searchResults.value = results
    selectedIndex.value = 0
  } catch (error) {
    console.error('Phase search failed:', error)
    searchResults.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void performSearch('')
  nextTick(() => searchInput.value?.focus())
})

let searchTimeout: NodeJS.Timeout | undefined
watch(searchQuery, (newValue) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    void performSearch(newValue)
  }, 150)
})

const selectItem = (payload: PhaseSearchSelection) => {
  emit('select', payload)
  emit('close')
}

const scrollToItem = (index: number) => {
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[index]
    item?.scrollIntoView({ block: 'nearest' })
  })
}

const focusResult = (index: number) => {
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[index]
    item?.focus()
    item?.scrollIntoView({ block: 'nearest' })
  })
}

const getEscapeSelection = (): PhaseSearchSelection | null => {
  const escapeOption = props.additionalOptions.find(option => option.actsAsEscape)
  return escapeOption ? { type: 'option', data: escapeOption } : null
}

const handleEscape = () => {
  const escapeSelection = getEscapeSelection()
  if (escapeSelection) {
    selectItem(escapeSelection)
  } else {
    emit('close')
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    handleEscape()
    return
  }

  if (event.key === 'Tab') {
    if (items.value.length === 0) return
    focusedResultIndex.value = selectedIndex.value
    focusResult(selectedIndex.value)
    return
  }

  if (items.value.length === 0) return

  if (event.key === 'ArrowDown') {
    selectedIndex.value = Math.min(selectedIndex.value + 1, items.value.length - 1)
    scrollToItem(selectedIndex.value)
    return
  }

  if (event.key === 'ArrowUp') {
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToItem(selectedIndex.value)
    return
  }

  const selected = items.value[selectedIndex.value]
  if (!selected) return

  if (selected.type === 'option') {
    selectItem({ type: 'option', data: selected.data })
  } else {
    selectItem({ type: 'phase', data: selected.data })
  }
}

const handleResultKeydown = (event: KeyboardEvent, index: number) => {
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'j', 'k', 'Tab'].includes(event.key)) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    handleEscape()
    return
  }

  if (event.key === 'Tab') {
    focusedResultIndex.value = -1
    searchInput.value?.focus()
    return
  }

  if (event.key === 'ArrowDown' || event.key === 'j') {
    const nextIndex = Math.min(index + 1, items.value.length - 1)
    selectedIndex.value = nextIndex
    focusedResultIndex.value = nextIndex
    focusResult(nextIndex)
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'k') {
    const nextIndex = Math.max(index - 1, 0)
    selectedIndex.value = nextIndex
    focusedResultIndex.value = nextIndex
    focusResult(nextIndex)
    return
  }

  const selected = items.value[index]
  if (!selected) return
  if (selected.type === 'option') {
    selectItem({ type: 'option', data: selected.data })
  } else {
    selectItem({ type: 'phase', data: selected.data })
  }
}
</script>

<template>
  <div class="search-overlay" @click.self="$emit('close')">
    <div class="search-modal">
      <div class="modal-header">
        <h3>{{ title }}</h3>
      </div>

      <div class="search-input-wrapper">
        <span class="search-icon">/</span>
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="text"
          :placeholder="placeholder"
          @keydown="handleKeydown"
        />
        <div v-if="loading" class="loader">...</div>
      </div>

      <div ref="resultsListRef" class="results-list">
        <div v-if="items.length > 0">
          <div
            v-for="(item, index) in items"
            :key="item.type === 'option' ? `option-${item.data.id}` : item.data.id"
            class="result-item"
            :class="{ selected: index === selectedIndex, 'additional-option': item.type === 'option' }"
            :tabindex="index === focusedResultIndex ? 0 : -1"
            @click="item.type === 'option' ? selectItem({ type: 'option', data: item.data }) : selectItem({ type: 'phase', data: item.data })"
            @mouseenter="selectedIndex = index"
            @focus="focusedResultIndex = index; selectedIndex = index"
            @keydown="handleResultKeydown($event, index)"
          >
            <template v-if="item.type === 'option'">
              <div class="result-text option-text">
                <span class="phase-name">{{ item.data.label }}</span>
                <span v-if="item.data.description" class="option-description">{{ item.data.description }}</span>
              </div>
            </template>

            <template v-else>
              <div class="result-text">
                <span class="phase-name">{{ item.data.name }}</span>
                <span class="phase-dates">
                  {{ timestampToLocalDate(item.data.from) }} - {{ timestampToLocalDate(item.data.to) }}
                </span>
              </div>
              <div class="phase-meta">
                <span v-if="item.data.parent" class="parent-badge">Sub-phase</span>
                <span v-else class="root-badge">Root</span>
              </div>
            </template>
          </div>
        </div>

        <div v-else class="no-results">
          No phases found.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1100;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 15vh;
}

.search-modal {
  width: 32rem;
  max-width: 92vw;
  max-height: 90vh;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 0.375rem;
  box-shadow: 0 0.25rem 1.25rem rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  padding: 0.9rem 1rem 0.75rem;
  border-bottom: 1px solid #333;
  background: #191919;
}

.modal-header h3 {
  margin: 0;
  font-size: 0.95rem;
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

.option-text {
  flex-direction: column;
  gap: 0.2rem;
}

.phase-name {
  color: #f0f0f0;
}

.phase-dates,
.option-description {
  color: #a6a6a6;
  font-size: 0.85rem;
}

.phase-meta {
  margin-top: 0.35rem;
}

.parent-badge,
.root-badge {
  font-size: 0.75rem;
  color: #c4c4c4;
}

.no-results {
  padding: 1rem;
  color: #888;
}
</style>
