<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import type { Aim } from 'shared'

const uiStore = useUIStore()
const dataStore = useDataStore()

const aimText = ref('')
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
  return searchResults.value[selectedSearchIndex.value] || null
})

const createAim = async () => {
  if (!aimText.value.trim() && !selectedSearchResult.value) return

  try {
    if (selectedSearchResult.value) {
      // TODO: Handle selecting existing aim from search
      console.warn('Search result selection not yet implemented')
      return
    }

    await uiStore.createAim(aimText.value.trim())
  } catch (error) {
    console.error('Failed to create aim:', error)
  }
}

const updateAim = async () => {
  const aim = uiStore.getCurrentAim()

  if(aim) {
    await dataStore.updateAim(uiStore.projectPath, aim.id, {
      text: aimText.value.trim(),
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
  } else if (event.ctrlKey && event.key === 'j') {
    event.preventDefault()
    if (selectedSearchIndex.value < searchResults.value.length - 1) {
      selectedSearchIndex.value++
    }
  } else if (event.ctrlKey && event.key === 'k') {
    event.preventDefault()
    if (selectedSearchIndex.value > 0) {
      selectedSearchIndex.value--
    }
  }
}

// Watch for search text changes
watch(aimText, (newValue) => {
  performSearch(newValue)
  selectedSearchIndex.value = 0
})

onMounted(async () => {
  let aim
  if (uiStore.aimModalMode === 'edit') {
    aim = uiStore.getCurrentAim()
  }

  console.log('Loaded aim for editing:', aim) 

  if (aim) {
    aimText.value = aim.text
    selectedStatus.value = aim.status.state
    statusComment.value = aim.status.comment
  } else {
    // Reset for create mode
    aimText.value = ''
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
        <div v-if="uiStore.aimModalMode === 'create' && searchResults.length > 0" class="search-results">
          <div class="search-header">Existing aims:</div>
          <div 
            v-for="(result, index) in searchResults"
            :key="result.id"
            class="search-result"
            :class="{ selected: index === selectedSearchIndex }"
          >
            <div class="result-text">{{ result.text }}</div>
            <div class="result-status" :class="result.status.state">
              {{ result.status.state }}
            </div>
          </div>
          <div class="search-help">
            Use <kbd>Ctrl+J</kbd>/<kbd>Ctrl+K</kbd> to navigate
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
      
      input, select {
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
  
  .search-header {
    padding: 0.5rem;
    background: #333;
    font-size: 0.9rem;
    color: #ccc;
    border-bottom: 1px solid #555;
  }
  
  .search-result {
    padding: 0.5rem;
    border-bottom: 1px solid #333;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    
    &.selected {
      background: #333;
    }
    
    &:hover:not(.selected) {
      background: #2a2a2a;
    }
    
    &:last-child {
      border-bottom: none;
    }
    
    .result-text {
      flex: 1;
      color: #e0e0e0;
    }
    
    .result-status {
      font-size: 0.8rem;
      text-transform: uppercase;
      font-weight: bold;
      
      &.open { color: #ffa500; }
      &.done { color: #00ff00; }
      &.cancelled { color: #ff0000; }
      &.partially { color: #ffff00; }
      &.failed { color: #ff6666; }
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