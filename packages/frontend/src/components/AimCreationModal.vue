<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import type { Aim } from 'shared'

const uiStore = useUIStore()
const dataStore = useDataStore()

const aimText = ref('')
const aimDescription = ref('')
const selectedStatus = ref<'open' | 'done' | 'cancelled' | 'partially' | 'failed'>('open')
const statusComment = ref('')
const searchResults = ref<Aim[]>([])
const selectedSearchIndex = ref(0)
const aimTextInput = ref<HTMLInputElement>()

// Real search functionality
const performSearch = async (query: string) => {
  if (!query.trim()) {
    searchResults.value = []
    return
  }

  try {
    const results = await trpc.aim.search.query({
      projectPath: uiStore.projectPath,
      query: query
    })
    searchResults.value = results.slice(0, 5) // Limit to 5 results
  } catch (error) {
    console.error('Failed to search aims:', error)
    searchResults.value = []
  }
}

const selectedSearchResult = computed(() => {
  // Index 0 is always "create new", so actual results start at index 1
  if (selectedSearchIndex.value === 0) {
    return null // "Create new" selected
  }
  return searchResults.value[selectedSearchIndex.value - 1] || null
})

const hasSearchText = computed(() => aimText.value.trim().length > 0)

const createAim = async () => {
  if (!aimText.value.trim() && !selectedSearchResult.value) return

  try {
    if (selectedSearchResult.value) {
      // Link existing aim
      await uiStore.createAim(selectedSearchResult.value.id, true)
    } else {
      // Create new aim with text and description
      await uiStore.createAim(aimText.value.trim(), false, aimDescription.value.trim())
    }
  } catch (error) {
    console.error('Failed to create/link aim:', error)
  }
}

const updateAim = async () => {
  const aim = uiStore.getCurrentAim()

  if(aim) {
    await dataStore.updateAim(uiStore.projectPath, aim.id, {
      text: aimText.value.trim(),
      description: aimDescription.value.trim(),
      status: {
        state: selectedStatus.value,
        comment: statusComment.value,
        date: Date.now()
      }
    })

    uiStore.closeAimModal()
  } else {
    console.error('Failed to update aim: no current aim')
  }
}

const handleSubmit = () => {
  if (uiStore.aimModalMode === 'edit') {
    updateAim()
  } else {
    createAim()
  }
}

const handleInputKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    handleSubmit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation() // Prevent escape from bubbling to global handler
    uiStore.closeAimModal()
  }
}

const handleTextareaKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    handleSubmit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    uiStore.closeAimModal()
  }
}

const handleSearchResultsKeydown = (event: KeyboardEvent) => {
  // In search results container: use J/K without Ctrl
  if (event.key === 'j' || event.key === 'J') {
    event.preventDefault()
    // Max index is searchResults.length (because index 0 is "create new")
    if (selectedSearchIndex.value < searchResults.value.length) {
      selectedSearchIndex.value++
    }
  } else if (event.key === 'k' || event.key === 'K') {
    event.preventDefault()
    if (selectedSearchIndex.value > 0) {
      selectedSearchIndex.value--
    }
  } else if (event.key === 'Enter') {
    event.preventDefault()
    handleSubmit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    uiStore.closeAimModal()
  }
}

const selectSearchResult = (index: number) => {
  selectedSearchIndex.value = index
}

// Watch for search text changes
watch(aimText, async (newValue) => {
  await performSearch(newValue)
  selectedSearchIndex.value = 0 // Reset to 'create new' by default

  const trimmedNewValue = newValue.trim().toLowerCase()

  if (trimmedNewValue.length > 0) {
    // Check for a perfect "starts with" match with 90% length threshold
    const perfectMatchIndex = searchResults.value.findIndex(result => {
      const resultTextLower = result.text.toLowerCase()
      // Check if result text starts with new value (case-insensitive)
      const startsWithMatch = resultTextLower.startsWith(trimmedNewValue)
      // Check 90% length threshold
      const lengthThresholdMet = trimmedNewValue.length >= (0.9 * resultTextLower.length)
      
      return startsWithMatch && lengthThresholdMet
    })

    if (perfectMatchIndex !== -1) {
      selectedSearchIndex.value = perfectMatchIndex + 1 // +1 because index 0 is "create new"
    }
  }
})

onMounted(async () => {
  let aim
  if (uiStore.aimModalMode === 'edit') {
    aim = uiStore.getCurrentAim()
  }

  console.log('Loaded aim for editing:', aim) 

  if (aim) {
    aimText.value = aim.text
    aimDescription.value = aim.description || ''
    selectedStatus.value = aim.status.state
    statusComment.value = aim.status.comment
  } else {
    // Reset for create mode
    aimText.value = ''
    aimDescription.value = ''
    selectedStatus.value = 'open'
    statusComment.value = ''
    searchResults.value = []
    selectedSearchIndex.value = 0
  }
  await nextTick()
  aimTextInput.value?.focus()
})

</script>

<template>
  <div class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3>{{ uiStore.aimModalMode === 'edit' ? 'Edit Aim' : 'Add Aim' }}</h3>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label>Aim Text</label>
          <input
            ref="aimTextInput"
            v-model="aimText"
            type="text"
            placeholder="Enter aim text"
            @keydown="handleInputKeydown"
          />
        </div>

        <div class="form-group">
          <label>Description (optional)</label>
          <textarea
            v-model="aimDescription"
            placeholder="Enter aim description"
            rows="3"
            @keydown="handleTextareaKeydown"
          ></textarea>
        </div>

        <!-- Status fields (edit mode only) -->
        <div v-if="uiStore.aimModalMode === 'edit'">
          <div class="form-group">
            <label>Status</label>
            <select v-model="selectedStatus" class="status-select" @keydown="handleInputKeydown">
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
              <option value="partially">Partially</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div class="form-group">
            <label>Status Comment (optional)</label>
            <input
              v-model="statusComment"
              type="text"
              placeholder="Add a comment about the status"
              @keydown="handleInputKeydown"
            />
          </div>
        </div>

        <!-- Search Results (create mode only) -->
        <div
          v-if="uiStore.aimModalMode === 'create' && hasSearchText"
          class="search-results"
          tabindex="0"
          @keydown="handleSearchResultsKeydown"
        >
          <!-- "Create new" entry (always first, index 0) -->
          <div
            class="search-result create-new"
            :class="{ selected: selectedSearchIndex === 0 }"
            @click="selectSearchResult(0)"
          >
            <div class="result-text">Create new: "{{ aimText }}"</div>
          </div>

          <!-- Existing aims (if any) -->
          <div
            v-for="(result, index) in searchResults"
            :key="result.id"
            class="search-result existing-aim"
            :class="{ selected: index + 1 === selectedSearchIndex }"
            @click="selectSearchResult(index + 1)"
          >
            <div class="result-text">{{ result.text }}</div>
            <div class="result-status" :class="result.status.state">
              {{ result.status.state }}
            </div>
          </div>

          <div class="search-help">
            Use <kbd>J</kbd>/<kbd>K</kbd> to navigate, <kbd>Tab</kbd> to buttons
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button @click="uiStore.closeAimModal" class="btn-secondary">
          Cancel
        </button>
        <button
          @click="handleSubmit"
          class="btn-primary"
          :disabled="!aimText.trim() && !selectedSearchResult"
        >
          {{ uiStore.aimModalMode === 'edit' ? 'Update' : (selectedSearchResult ? 'Link Existing' : 'Create New') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  width: 31.25rem;
  max-width: 90vw;
  
  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid #555;
    
    h3 {
      margin: 0;
    }
  }
  
  .modal-body {
    padding: 1rem;
    
    .form-group {
      margin-bottom: 1rem;
      
      label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: bold;
        color: #ccc;
      }
      
      input, select, textarea {
        width: 100%;
        padding: 0.5rem;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 0.1875rem;
        color: #e0e0e0;
        font-family: monospace;

        &:focus {
          outline: none;
          border-color: #007acc;
        }

        &::placeholder {
          color: #666;
        }
      }

      textarea {
        resize: vertical;
      }

      select {
        cursor: pointer;
      }
    }
  }
  
  .modal-footer {
    padding: 1rem;
    border-top: 1px solid #555;
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    
    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 0.1875rem;
      cursor: pointer;
      font-family: monospace;
      
      &.btn-primary {
        background: #007acc;
        color: white;
        
        &:hover:not(:disabled) {
          background: #005a99;
        }
        
        &:disabled {
          background: #444;
          color: #666;
          cursor: not-allowed;
        }
      }
      
      &.btn-secondary {
        background: #444;
        color: #e0e0e0;
        
        &:hover {
          background: #555;
        }
      }
    }
  }
}

.search-results {
  max-height: 12.5rem;
  overflow-y: auto;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  background: #1a1a1a;

  .search-result {
    padding: 0.5rem;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0.25rem;
    border-radius: 0.1875rem;

    &.create-new {
      border: 1px dotted #555;
    }

    &.existing-aim {
      border: 1px solid #555;
    }

    &.selected {
      background: #333;
    }

    &:hover:not(.selected) {
      background: #2a2a2a;
    }
    
    .result-text {
      flex: 1;
      color: #e0e0e0;
    }
    
    .result-status {
      font-size: 0.8rem;
      text-transform: uppercase;
      font-weight: bold;

      &.open { color: var(--status-open); }
      &.done { color: var(--status-done); }
      &.cancelled { color: var(--status-cancelled); }
      &.partially { color: var(--status-partially); }
      &.failed { color: var(--status-failed); }
    }
  }
  
  .search-help {
    padding: 0.5rem;
    font-size: 0.8rem;
    color: #888;
    text-align: center;
    border-top: 1px solid #333;
    
    kbd {
      background: #444;
      color: #fff;
      padding: 0.125rem 0.25rem;
      border-radius: 0.1875rem;
      font-size: 0.7rem;
      font-family: monospace;
    }
  }
}
</style>