<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useUIStore, type AimPath } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import type { SearchAimResult, Aim } from 'shared'

const uiStore = useUIStore()
const dataStore = useDataStore()

const emit = defineEmits<{
  (e: 'select', payload: { type: 'aim', data: Aim } | { type: 'path', data: AimPath }): void
  (e: 'close'): void
}>()

const searchQuery = ref('')
const searchResults = ref<SearchAimResult[]>([])
const selectedIndex = ref(0) // Visual selection
const focusedResultIndex = ref(-1) // Actual DOM focus index for results, -1 means input is focused
const searchInput = ref<HTMLInputElement>()
const resultsListRef = ref<HTMLDivElement>()
const loading = ref(false)

// Path selection state
const pathSelectionMode = ref(false)
const availablePaths = ref<(AimPath & { label: string })[]>([])
const selectedAimText = ref('')

// Filter State
const selectedStatuses = ref<string[]>([])
const includeArchived = ref(false)
const isStatusDropdownOpen = ref(false)
const availableStatuses = computed(() => dataStore.getStatuses)

const toggleStatus = (status: string) => {
  const index = selectedStatuses.value.indexOf(status)
  if (index === -1) {
    selectedStatuses.value.push(status)
  } else {
    selectedStatuses.value.splice(index, 1)
  }
}

// Watch filters to trigger search
watch([selectedStatuses, includeArchived], () => {
  performSearch(searchQuery.value)
}, { deep: true })

const performSearch = async (query: string) => {
  if (!query.trim()) {
    searchResults.value = []
    return
  }

  loading.value = true
  try {
    const [flexSearchResults, semanticSearchResults] = await Promise.all([
      trpc.aim.search.query({
        projectPath: uiStore.projectPath,
        query: query,
        limit: 10,
        status: selectedStatuses.value.length > 0 ? selectedStatuses.value : undefined,
        archived: includeArchived.value
      }),
      trpc.aim.searchSemantic.query({
        projectPath: uiStore.projectPath,
        query: query,
        limit: 30,
        status: selectedStatuses.value.length > 0 ? selectedStatuses.value : undefined,
        // Semantic search doesn't support archived flag in backend yet? 
        // Checked server.ts: It DOES accept input.status and input.phaseId, but NOT archived flag?
        // Let's check server.ts searchSemantic input.
        // It accepts 'status' and 'phaseId'. 'archived' is missing in searchSemantic input schema.
        // So we can't filter archived in semantic search on server side?
        // Wait, searchSemantic uses `searchVectors`.
        // Then `readAim` and checks status/phaseId.
        // If archived aims are indexed, they will be found.
        // But `readAim` reads from `aims/` or `archived-aims/`.
        // If we want to include archived, we might need to update backend searchSemantic.
        // For now, let's omit it for semantic or rely on client filtering if needed.
        // Or better: filter client side if backend doesn't support.
        // But FlexSearch supports it.
        // Let's skip passing it to semantic for now to avoid error if schema validation fails.
      })
    ])

    const combinedResultsMap = new Map<string, SearchAimResult>()

    // Process Semantic Results first
    semanticSearchResults.forEach(aim => {
      combinedResultsMap.set(aim.id, { ...aim })
    })

    // Process Keyword Results (FlexSearch)
    flexSearchResults.forEach(aim => {
      const existing = combinedResultsMap.get(aim.id)
      if (existing) {
        // Found in both: Boost score!
        const semanticScore = existing.score || 0
        const keywordScore = aim.score || 0
        
        // Take the stronger signal and add a bonus for confirmation
        existing.score = Math.max(semanticScore, keywordScore) + 0.2
      } else {
        // Found only in keyword search
        combinedResultsMap.set(aim.id, { ...aim })
      }
    })

    // Convert map to array and sort by score (desc)
    const sortedResults = Array.from(combinedResultsMap.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10) // Limit to top 10 overall results

    searchResults.value = sortedResults
    selectedIndex.value = 0 // Top result always selected
    focusedResultIndex.value = -1 // Reset focus to input when results change
  } catch (error) {
    console.error('Search failed:', error)
    searchResults.value = []
  }
  finally {
    loading.value = false
  }
}

// Debounce search
let searchTimeout: NodeJS.Timeout
watch(searchQuery, (newVal) => {
  if (pathSelectionMode.value) return // Don't search while selecting path

  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    performSearch(newVal)
  }, 150)
})

const blockLeakage = (e: KeyboardEvent) => {
  // If typing in search input, let it through to the input but stop it from reaching others
  // UNLESS it's a navigation key (ArrowDown, ArrowUp, Enter) which we want to handle
  const isNavKey = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)
  const isInputTarget = e.target === searchInput.value

  if (isInputTarget && !isNavKey) {
    e.stopPropagation()
    return
  }
  
  // Handle navigation/selection logic
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    if (pathSelectionMode.value) {
      pathSelectionMode.value = false
      selectedIndex.value = 0
      focusedResultIndex.value = -1
      nextTick(() => searchInput.value?.focus())
    } else {
      close()
    }
    return
  }

  const listLength = pathSelectionMode.value ? availablePaths.value.length : searchResults.value.length
  if (listLength === 0) return

  switch(e.key) {
    case 'ArrowDown':
    case 'j':
      if (!isInputTarget || e.key === 'ArrowDown') {
         focusedResultIndex.value = selectedIndex.value
         if (focusedResultIndex.value < listLength - 1) {
            focusedResultIndex.value++
            selectedIndex.value = focusedResultIndex.value
            nextTick(() => {
                const items = resultsListRef.value?.querySelectorAll('.result-item')
                const el = items?.[focusedResultIndex.value] as HTMLElement
                if (el) {
                    el.focus()
                    el.scrollIntoView({ block: 'nearest' })
                }
            })
         }
      }
      break
    case 'ArrowUp':
    case 'k':
      if (!isInputTarget || e.key === 'ArrowUp') {
         if (focusedResultIndex.value > 0) {
            focusedResultIndex.value--
            selectedIndex.value = focusedResultIndex.value
            nextTick(() => {
                const items = resultsListRef.value?.querySelectorAll('.result-item')
                const el = items?.[focusedResultIndex.value] as HTMLElement
                if (el) {
                    el.focus()
                    el.scrollIntoView({ block: 'nearest' })
                }
            })
         } else if (focusedResultIndex.value === 0) {
             // Go back to input? Optional. Currently we stay at top.
         }
      }
      break
    case 'Enter':
      if (pathSelectionMode.value) {
        const path = availablePaths.value[selectedIndex.value]
        if (path) selectPath(path)
      } else {
        const result = searchResults.value[selectedIndex.value]
        if (result) selectAim(result)
      }
      break
    case 'Tab':
      if (isInputTarget) {
         if (listLength > 0) {
             focusedResultIndex.value = selectedIndex.value
             nextTick(() => {
                 const items = resultsListRef.value?.querySelectorAll('.result-item')
                 const el = items?.[focusedResultIndex.value] as HTMLElement
                 if (el) el.focus()
             })
         }
      } else {
          focusedResultIndex.value = -1
          searchInput.value?.focus()
      }
      break
  }
}

const selectAim = async (aim: SearchAimResult) => {
  if (uiStore.aimSearchMode === 'pick') {
      try {
        // Ensure we pass a full Aim object
        const fullAim = await trpc.aim.get.query({ projectPath: uiStore.projectPath, aimId: aim.id });
        emit('select', { type: 'aim', data: fullAim });
      } catch (e) {
        console.error("Failed to load aim for selection", e);
        // Fallback to SearchAimResult (it extends Aim mostly) if fetch fails?
        // Better to fail safely or just pass what we have if compatible.
        // SearchAimResult has score, but is compatible with Aim structure generally.
        emit('select', { type: 'aim', data: aim as unknown as Aim });
      }
      close();
      return;
  }

  loading.value = true
  try {
    const paths = await uiStore.prepareNavigation(aim.id)
    
    if (paths.length === 0) {
      console.warn('No paths found for aim', aim.id)
      close()
    } else if (paths.length === 1 && paths[0]) {
      emit('select', { type: 'path', data: paths[0] })
      close()
    } else {
      // Multiple paths found, present selection
      selectedAimText.value = aim.text.length > 50 ? aim.text.substring(0, 50) + '...' : aim.text
      
      const enrichedPaths = await Promise.all(paths.map(async p => {
        let label = ''
        if (p.phaseId) {
            let phase = dataStore.phases[p.phaseId]
            if (!phase) {
                try { phase = await trpc.phase.get.query({ projectPath: uiStore.projectPath, phaseId: p.phaseId }) } catch {}
            }
            label = phase ? phase.name : 'Unknown Phase'
        } else {
            label = 'Floating'
        }
        
        // Construct trail: root > parent > ... (excluding target aim itself)
        const trail = p.aims.slice(0, -1).map(a => a.text).join(' > ')
        if (trail) label += ' > ' + trail
        
        return { ...p, label }
      }))
      
      availablePaths.value = enrichedPaths
      pathSelectionMode.value = true
      selectedIndex.value = 0
      focusedResultIndex.value = 0 // Focus first path immediately? Or keep input focused?
      // Requirements: "The path list should be like the result list... in place of results list"
      // Let's focus the list immediately for better UX since typing isn't useful here
      nextTick(() => {
        if (resultsListRef.value?.children[0]) {
            (resultsListRef.value.children[0] as HTMLElement).focus()
        }
      })
    }
  } catch (error) {
    console.error('Error preparing navigation:', error)
  } finally {
    loading.value = false
  }
}

const selectPath = async (path: AimPath) => {
  emit('select', { type: 'path', data: path })
  close()
}

const close = () => {
  searchQuery.value = ''
  searchResults.value = []
  selectedIndex.value = 0
  focusedResultIndex.value = -1
  pathSelectionMode.value = false
  availablePaths.value = []
  emit('close')
}

onMounted(() => {
  // Ensure terminals lose focus
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  
  // Capture phase to intercept before terminals
  window.addEventListener('keydown', blockLeakage, true)
  
  // Check if we have an initial aim ID to select immediately
  if (uiStore.aimSearchInitialAimId) {
    const aimId = uiStore.aimSearchInitialAimId
    loading.value = true
    trpc.aim.get.query({ projectPath: uiStore.projectPath, aimId }).then(aim => {
        // Construct a SearchAimResult compatible object
        const searchResult: SearchAimResult = {
            id: aim.id,
            text: aim.text,
            status: aim.status,
            tags: aim.tags
        }
        selectAim(searchResult)
    }).catch(e => {
        console.error("Failed to load initial aim", e)
        loading.value = false
    })
  } else {
    // Ensure input is focused when modal opens
    nextTick(() => searchInput.value?.focus())
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockLeakage, true)
})
</script>

<template>
  <div class="search-overlay" @click.self="close">
    <div class="search-modal">
      <div class="filter-bar">
        <div class="filter-group relative">
          <button 
            @click="isStatusDropdownOpen = !isStatusDropdownOpen" 
            class="filter-btn"
            :class="{ active: selectedStatuses.length > 0 || isStatusDropdownOpen }"
          >
            Status {{ selectedStatuses.length > 0 ? `(${selectedStatuses.length})` : '' }} ▼
          </button>
          
          <!-- Dropdown overlay to close on click outside -->
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

      <div class="search-input-wrapper">
        <span class="search-icon">/</span>
        <!-- Search Input -->
        <input 
          v-if="!pathSelectionMode"
          ref="searchInput"
          v-model="searchQuery" 
          type="text" 
          placeholder="Go to aim..." 
          @focus="focusedResultIndex = -1"
        />
        <!-- Path Selection Header -->
        <div v-else class="path-selection-header">
          Select path to aim: <strong>"{{ selectedAimText }}"</strong>
        </div>
        <div v-if="loading" class="loader">...</div>
      </div>
      
      <!-- Search Results -->
      <div v-if="!pathSelectionMode" ref="resultsListRef" class="results-list" >
        <div v-if="searchResults.length > 0">
          <div 
            v-for="(result, index) in searchResults" 
            :key="result.id"
            class="result-item"
            :class="{ selected: index === selectedIndex }"
            @click="selectAim(result)"
            :tabindex="index === focusedResultIndex ? 0 : -1"
            @focus="focusedResultIndex = index; selectedIndex = index"
          >
            <div class="result-text">
              <span class="aim-text">{{ result.text }}</span>
              <span class="aim-status" :class="result.status.state">{{ result.status.state }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="searchQuery && !loading" class="no-results">
          No aims found.
        </div>
      </div>

      <!-- Path Selection List -->
      <div v-else ref="resultsListRef" class="results-list">
        <div 
          v-for="(path, index) in availablePaths" 
          :key="index"
          class="result-item"
          :class="{ selected: index === selectedIndex }"
          @click="selectPath(path)"
          @mouseover="selectedIndex = index"
          :tabindex="index === focusedResultIndex ? 0 : -1"
          @focus="focusedResultIndex = index; selectedIndex = index"
        >
          <div class="result-text">
            <span class="path-text">{{ path.label }}</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999; /* Increase z-index */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 20vh;
}

.search-modal {
  width: 600px;
  max-width: 90vw;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #333;
  background: #1e1e1e;
  min-height: 3rem;
}

.filter-bar {
  display: flex;
  padding: 8px 16px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  gap: 16px;
  align-items: center;
}

.filter-btn {
  background: #333;
  border: 1px solid #444;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8rem;
}

.filter-btn.active {
  background: #444;
  border-color: #555;
  color: #fff;
}

.relative {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 3px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.5);
  z-index: 100;
  min-width: 150px;
  margin-top: 4px;
}

.dropdown-item {
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.8rem;
}

.dropdown-item:hover {
  background: #333;
}

.dropdown-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 99;
  background: transparent;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #ccc;
  cursor: pointer;
}

.path-selection-header {
  flex: 1;
  color: #e0e0e0;
  font-size: 1rem;
}

.search-icon {
  color: #888;
  font-weight: bold;
  margin-right: 10px;
  font-size: 1.2em;
}

input {
  flex: 1;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 1.1em;
  outline: none;
}

.results-list {
  max-height: 400px;
  overflow-y: auto;
}

.result-item {
  padding: 10px 16px;
  border-bottom: 1px solid #2d2d2d;
  cursor: pointer;
}

.result-item.selected {
  background: #094771; /* VS Code selection blue */
}

.result-item:focus {
  outline: none;
  border: 1px solid #007acc; /* Custom focus border for accessibility */
  margin: -1px; /* Offset border to not increase size and cause layout shift */
}

.result-text {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.aim-text {
  font-weight: 500;
}

.path-text {
  font-size: 0.9rem;
  color: #ccc;
}

.aim-status {
  font-size: 0.75em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: #333;
  color: #aaa;
}

.aim-status.open { color: var(--status-open); }
.aim-status.done { color: var(--status-done); }
  .aim-status.cancelled { color: var(--status-cancelled); }
  .aim-status.partially { color: var(--status-partially); }
  .aim-status.failed { color: var(--status-failed); }
  .aim-status.unclear { color: var(--status-unclear); }

  .no-results {  padding: 20px;
  text-align: center;
  color: #888;
}
</style>
