<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import type { Aim } from 'shared'

const uiStore = useUIStore()
const dataStore = useDataStore()

const aimText = ref('')
const searchResults = ref<Aim[]>([])
const selectedSearchIndex = ref(0)
const aimTextInput = ref<HTMLInputElement>()

// Mock search functionality
const performSearch = (query: string) => {
  if (!query.trim()) {
    searchResults.value = []
    return
  }
  
  // Mock search results - filter existing aims by text match  
  // For now, just use an empty array since we don't have current phase context
  const allAims: any[] = []
  searchResults.value = allAims.filter(aim => 
    aim.text.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5) // Limit to 5 results
}

const selectedSearchResult = computed(() => {
  return searchResults.value[selectedSearchIndex.value] || null
})

const createAim = async () => {
  if (!aimText.value.trim() && !selectedSearchResult.value) return

  try {
    let aimId: string

    if (selectedSearchResult.value) {
      // Use selected search result
      aimId = selectedSearchResult.value.id
    } else {
      // Create new aim
      const result = await dataStore.createAim(uiStore.projectPath, {
        text: aimText.value.trim(),
        incoming: [],
        outgoing: [],
        committedIn: [],
        status: {
          state: 'open',
          comment: '',
          date: Date.now()
        }
      })
      aimId = result.id
    }

    // Commit aim to phase at the specified insertion index
    const phaseId = uiStore.aimModalPhaseId
    const insertionIndex = uiStore.aimModalInsertionIndex

    if (phaseId) {
      await dataStore.commitAimToPhase(uiStore.projectPath, aimId, phaseId, insertionIndex)
      // Reload phase aims
      await dataStore.loadPhaseAims(uiStore.projectPath, phaseId)
    }

    uiStore.closeAimModal()
  } catch (error) {
    console.error('Failed to create aim:', error)
  }
}

const handleInputKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    createAim()
  } else if (event.key === 'Escape') {
    event.preventDefault()
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

// Focus input when modal opens
watch(() => uiStore.showAimModal, async (newVal) => {
  if (newVal) {
    await nextTick()
    aimTextInput.value?.focus()
    aimText.value = ''
    searchResults.value = []
    selectedSearchIndex.value = 0
  }
})

</script>

<template>
  <div v-if="uiStore.showAimModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3>Add Aim</h3>
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
        
        <!-- Search Results -->
        <div v-if="searchResults.length > 0" class="search-results">
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
          @click="createAim" 
          class="btn-primary" 
          :disabled="!aimText.trim() && !selectedSearchResult"
        >
          {{ selectedSearchResult ? 'Link Existing' : 'Create New' }}
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
      
      input {
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