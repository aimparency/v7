<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../stores/ui'
import { trpc } from '../trpc'
import type { Phase } from 'shared'
import { timestampToLocalDate } from 'shared'

const uiStore = useUIStore()

const props = defineProps<{
  excludePhaseId?: string | null // ID to exclude (e.g. self)
}>()

const emit = defineEmits<{
  (e: 'select', phase: Phase): void
  (e: 'close'): void
}>()

const searchQuery = ref('')
const searchResults = ref<Phase[]>([])
const selectedIndex = ref(0)
const focusedResultIndex = ref(-1)
const searchInput = ref<HTMLInputElement>()
const resultsListRef = ref<HTMLDivElement>()
const loading = ref(false)

const performSearch = async (query: string) => {
  loading.value = true
  try {
    // Search phases via backend
    // If query is empty, we might want to list all phases (or recent ones)
    // The backend searchPhases returns all if query is empty.
    let results = await trpc.phase.search.query({
      projectPath: uiStore.projectPath,
      query: query
    })
    
    // Client-side filtering
    if (props.excludePhaseId) {
       results = results.filter(p => p.id !== props.excludePhaseId)
       // We also need to filter descendants to avoid cycles, but that's expensive to calculate here without full tree.
       // For now, let's just trust the user or validation on submit. 
       // Better: The PhaseCreationModal validated "availableParents". 
       // We can just return the phase and let PhaseCreationModal validate/reject it.
    }

    // Sort: Active phases first, then by date desc
    const now = Date.now()
    results.sort((a, b) => {
        const aActive = a.from <= now && a.to >= now
        const bActive = b.from <= now && b.to >= now
        if (aActive && !bActive) return -1
        if (!aActive && bActive) return 1
        return b.from - a.from // Newest first
    })

    searchResults.value = results
    selectedIndex.value = 0
    focusedResultIndex.value = -1
  } catch (error) {
    console.error('Phase search failed:', error)
    searchResults.value = []
  } finally {
    loading.value = false
  }
}

// Initial load (empty query)
onMounted(() => {
    performSearch('')
    nextTick(() => searchInput.value?.focus())
})

let searchTimeout: NodeJS.Timeout
watch(searchQuery, (newVal) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    performSearch(newVal)
  }, 150)
})

const selectPhase = (phase: Phase) => {
  emit('select', phase)
  emit('close')
}

const handleKeydown = (e: KeyboardEvent) => {
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
    e.preventDefault()
    e.stopPropagation()
    
    if (e.key === 'Escape') {
      emit('close')
      return
    }

    const listLength = searchResults.value.length
    if (listLength === 0) return

    switch(e.key) {
        case 'ArrowDown':
             focusedResultIndex.value = selectedIndex.value
             if (focusedResultIndex.value < listLength - 1) {
                focusedResultIndex.value++
                selectedIndex.value = focusedResultIndex.value
                scrollToItem(focusedResultIndex.value)
             }
             break
        case 'ArrowUp':
             if (focusedResultIndex.value > 0) {
                focusedResultIndex.value--
                selectedIndex.value = focusedResultIndex.value
                scrollToItem(focusedResultIndex.value)
             }
             break
        case 'Enter':
             {
                 const selected = searchResults.value[selectedIndex.value]
                 if (selected) {
                     selectPhase(selected)
                 }
             }
             break
    }
  }
}

const scrollToItem = (index: number) => {
    nextTick(() => {
        const items = resultsListRef.value?.querySelectorAll('.result-item')
        const el = items?.[index] as HTMLElement
        if (el) {
            el.scrollIntoView({ block: 'nearest' })
        }
    })
}

</script>

<template>
  <div class="search-overlay" @click.self="$emit('close')">
    <div class="search-modal">
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input 
          ref="searchInput"
          v-model="searchQuery" 
          type="text" 
          placeholder="Search phases..." 
          @keydown="handleKeydown"
        />
        <div v-if="loading" class="loader">...</div>
      </div>
      
      <div ref="resultsListRef" class="results-list">
        <div v-if="searchResults.length > 0">
          <div 
            v-for="(phase, index) in searchResults" 
            :key="phase.id"
            class="result-item"
            :class="{ selected: index === selectedIndex }"
            @click="selectPhase(phase)"
            @mouseover="selectedIndex = index; focusedResultIndex = index"
          >
            <div class="result-text">
              <span class="phase-name">{{ phase.name }}</span>
              <span class="phase-dates">
                  {{ timestampToLocalDate(phase.from) }} - {{ timestampToLocalDate(phase.to) }}
              </span>
            </div>
            <div class="phase-meta">
                <span v-if="phase.parent" class="parent-badge">Sub-phase</span>
                <span v-else class="root-badge">Root</span>
            </div>
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
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 300; /* Higher than PhaseCreationModal (200) */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 15vh;
}

.search-modal {
  width: 500px;
  max-width: 90vw;
  max-height: 90vh;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #333;
  background: #1e1e1e;
}

.search-icon {
  margin-right: 10px;
}

input {
  flex: 1;
  background: transparent;
  border: none;
  /* Font size inherited from global */
  outline: none;
}

.results-list {
  max-height: 300px;
  overflow-y: auto;
}

.result-item {
  padding: 10px 16px;
  border-bottom: 1px solid #2d2d2d;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-item.selected {
  background: #094771;
}

.result-text {
  display: flex;
  flex-direction: column;
}

.phase-name {
  font-weight: 500;
  color: #e0e0e0;
}

.phase-dates {
  font-size: 0.8rem;
  color: #888;
}

.phase-meta {
    font-size: 0.75rem;
}

.root-badge {
    background: #333;
    color: #aaa;
    padding: 2px 6px;
    border-radius: 3px;
}

.parent-badge {
    background: #444;
    color: #ccc;
    padding: 2px 6px;
    border-radius: 3px;
}

.no-results {
  padding: 20px;
  text-align: center;
  color: #888;
}
</style>