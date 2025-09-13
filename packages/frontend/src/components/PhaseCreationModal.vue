<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'

const uiStore = useUIStore()
const dataStore = useDataStore()

const phaseNameInput = ref<HTMLInputElement>()

const createPhase = async () => {
  if (!uiStore.newPhaseName.trim()) return
  
  let parentPhaseId = null
  
  if (uiStore.focusedColumn === 'right' && dataStore.leftColumnPhases.length > 0) {
    const selectedPhase = dataStore.leftColumnPhases[uiStore.selectedPhaseIndex]
    // If we're creating a child of the null phase, parent should be null
    parentPhaseId = selectedPhase.id === 'null' ? null : selectedPhase.id
  }
  
  try {
    await dataStore.createPhase(uiStore.projectPath, {
      name: uiStore.newPhaseName.trim(),
      from: uiStore.newPhaseStartDate ? 
        new Date(uiStore.newPhaseStartDate).getTime() : 
        Date.now(),
      to: uiStore.newPhaseEndDate ? 
        new Date(uiStore.newPhaseEndDate).getTime() : 
        Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days default
      parent: parentPhaseId,
      commitments: []
    })
    
    uiStore.closePhaseModal()
  } catch (error) {
    console.error('Failed to create phase:', error)
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    createPhase()
  } else if (event.key === 'Escape') {
    uiStore.closePhaseModal()
  }
}

// Focus input when modal opens
watch(() => uiStore.showPhaseModal, async (newVal) => {
  if (newVal) {
    await nextTick()
    phaseNameInput.value?.focus()
  }
})
</script>

<template>
  <div v-if="uiStore.showPhaseModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3>Create New Phase</h3>
      </div>
      
      <div class="modal-body">
        <div class="form-group">
          <label>Phase Name</label>
          <input 
            ref="phaseNameInput"
            v-model="uiStore.newPhaseName" 
            type="text" 
            placeholder="Enter phase name"
            @keydown="handleKeydown"
          />
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input v-model="uiStore.newPhaseStartDate" type="date" />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input v-model="uiStore.newPhaseEndDate" type="date" />
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button @click="uiStore.closePhaseModal" class="btn-secondary">
          Cancel
        </button>
        <button 
          @click="createPhase" 
          class="btn-primary" 
          :disabled="!uiStore.newPhaseName.trim()"
        >
          Create
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
  border-radius: 5px;
  width: 400px;
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
        border-radius: 3px;
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
    
    .form-row {
      display: flex;
      gap: 1rem;
      
      .form-group {
        flex: 1;
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
      border-radius: 3px;
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
</style>