<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import type { Phase } from 'shared'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import { timestampToLocalDate, timestampToLocalTime, localDateTimeToTimestamp } from 'shared'

const uiStore = useUIStore()
const dataStore = useDataStore()

const phaseNameInput = ref<HTMLInputElement>()
const submitBtn = ref<HTMLButtonElement>()
const dateWarning = ref<string>('')
const allPhases = ref<Phase[]>([])

const availableParents = computed(() => {
  if (uiStore.phaseModalMode !== 'edit' || !uiStore.phaseModalEditingPhaseId) return []

  const selfId = uiStore.phaseModalEditingPhaseId
  const phaseMap = new Map(allPhases.value.map(p => [p.id, p]))

  // Helper to check if candidate is a descendant of self
  const isDescendant = (candidate: Phase) => {
    let current = candidate
    const visited = new Set<string>()
    
    while (current.parent) {
      if (current.parent === selfId) return true
      if (visited.has(current.id)) break // Cycle in existing tree
      visited.add(current.id)
      
      const parent = phaseMap.get(current.parent)
      if (!parent) break
      current = parent
    }
    return false
  }

  return allPhases.value.filter(p => {
    // Exclude self
    if (p.id === selfId) return false
    // Exclude descendants (to avoid cycles)
    if (isDescendant(p)) return false
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))
})

const createPhase = async () => {
  if (!uiStore.newPhaseName.trim()) return;

  try {
    await uiStore.createPhase(
      uiStore.newPhaseName.trim(),
      localDateTimeToTimestamp(uiStore.newPhaseStartDate, uiStore.newPhaseStartTime),
      localDateTimeToTimestamp(uiStore.newPhaseEndDate, uiStore.newPhaseEndTime)
    );
    uiStore.closePhaseModal();
  } catch (error) {
    console.error('Failed to create phase:', error);
  }
}

const updatePhase = async () => {
  if (!uiStore.newPhaseName.trim()) return
  if (!uiStore.phaseModalEditingPhaseId) return

  try {
    const oldPhase = dataStore.phases[uiStore.phaseModalEditingPhaseId]
    const oldParentId = oldPhase?.parent ?? null

    const updatedPhase = await trpc.phase.update.mutate({
      projectPath: uiStore.projectPath,
      phaseId: uiStore.phaseModalEditingPhaseId,
      phase: {
        name: uiStore.newPhaseName.trim(),
        from: localDateTimeToTimestamp(uiStore.newPhaseStartDate, uiStore.newPhaseStartTime),
        to: localDateTimeToTimestamp(uiStore.newPhaseEndDate, uiStore.newPhaseEndTime),
        parent: uiStore.phaseModalEditingParentId
      }
    })

    // Update the local store with the updated phase
    if (updatedPhase) {
      dataStore.phases[updatedPhase.id] = updatedPhase
      
      // Reload the new parent's children
      await dataStore.loadPhases(uiStore.projectPath, updatedPhase.parent);
      
      // If parent changed, reload the old parent's children too to remove the ghost entry
      if (oldParentId !== updatedPhase.parent) {
        await dataStore.loadPhases(uiStore.projectPath, oldParentId);
      }
    }

    uiStore.closePhaseModal()
  } catch (error) {
    console.error('Failed to update phase:', error)
  }
}

const handleSubmit = () => {
  if (uiStore.phaseModalMode === 'edit') {
    updatePhase()
  } else {
    createPhase()
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    handleSubmit()
  } else if (event.key === 'Escape') {
    uiStore.closePhaseModal()
  }
}

// Calculate smart date ranges when modal opens (only for create mode)
watch(() => uiStore.showPhaseModal, async (newVal) => {
  if (newVal) {
    if (uiStore.phaseModalMode === 'create') {
      await calculateSmartDateRanges()
      await nextTick()
      phaseNameInput.value?.focus()
    } else if (uiStore.phaseModalMode === 'edit') {
      // Load all phases for parent selection
      allPhases.value = await trpc.phase.list.query({ projectPath: uiStore.projectPath })
      await nextTick()
      phaseNameInput.value?.focus()
    }
  }
})

const calculateSmartDateRanges = async () => {
  dateWarning.value = ''
  
  // Priority 1: Copy from currently selected phase (if a phase is selected when pressing 'o')
  if (uiStore.selectedColumn > 0) {
    const selectedPhaseId = uiStore.getSelectedPhaseId(uiStore.selectedColumn)
    if (selectedPhaseId) {
      try {
        const selectedPhase = await trpc.phase.get.query({
          projectPath: uiStore.projectPath,
          phaseId: selectedPhaseId
        })
        if (selectedPhase) {
          // Extract local date and time from timestamps
          uiStore.newPhaseStartDate = timestampToLocalDate(selectedPhase.from) || ''
          uiStore.newPhaseStartTime = timestampToLocalTime(selectedPhase.from) || ''
          uiStore.newPhaseEndDate = timestampToLocalDate(selectedPhase.to) || ''
          uiStore.newPhaseEndTime = timestampToLocalTime(selectedPhase.to) || ''
          return
        }
      } catch (error) {
        console.error('Failed to get selected phase dates:', error)
      }
    }
  }

  // Priority 2: Copy from parent phase (one column to the left)
  if (uiStore.selectedColumn > 1) {
    const parentColumn = uiStore.selectedColumn - 1
    const parentPhaseIdFromColumn = uiStore.getSelectedPhaseId(parentColumn)
    if (parentPhaseIdFromColumn) {
      try {
        const parentPhase = await trpc.phase.get.query({
          projectPath: uiStore.projectPath,
          phaseId: parentPhaseIdFromColumn
        })
        if (parentPhase) {
          uiStore.newPhaseStartDate = timestampToLocalDate(parentPhase.from)
          uiStore.newPhaseStartTime = timestampToLocalTime(parentPhase.from)
          uiStore.newPhaseEndDate = timestampToLocalDate(parentPhase.to)
          uiStore.newPhaseEndTime = timestampToLocalTime(parentPhase.to)
          return
        }
      } catch (error) {
        console.error('Failed to get parent phase dates:', error)
      }
    }
  }

  // Priority 3: Default for root phases (column 1, "very first phase" scenario)
  // Current date 00:00 to current date + 7 days 00:00
  const now = new Date()
  uiStore.newPhaseStartDate = now.toISOString().split('T')[0] || '' // YYYY-MM-DD
  uiStore.newPhaseStartTime = '00:00'
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  uiStore.newPhaseEndDate = sevenDaysLater.toISOString().split('T')[0] || ''
  uiStore.newPhaseEndTime = '00:00'
}
</script>

<template>
  <div v-if="uiStore.showPhaseModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3>{{ uiStore.phaseModalMode === 'edit' ? 'Edit Phase' : 'Create New Phase' }}</h3>
      </div>
      
      <div class="modal-body">
        <div class="form-group">
          <label>Phase Name</label>
          <input 
            ref="phaseNameInput"
            v-model="uiStore.newPhaseName" 
            type="text" 
            placeholder="Enter phase name"
            @keydown.enter="handleKeydown"
            @keydown.esc="handleKeydown"
            @keydown.shift.tab.exact.prevent="submitBtn?.focus()"
          />
        </div>

        <div v-if="uiStore.phaseModalMode === 'edit'" class="form-group">
          <label>Parent Phase</label>
          <select v-model="uiStore.phaseModalEditingParentId" @keydown="handleKeydown">
            <option :value="null">Root (No Parent)</option>
            <option v-for="phase in availableParents" :key="phase.id" :value="phase.id">
              {{ phase.name }}
            </option>
          </select>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input v-model="uiStore.newPhaseStartDate" type="date" @keydown="handleKeydown"/>
            <input v-model="uiStore.newPhaseStartTime" type="time" @keydown="handleKeydown"/>
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input v-model="uiStore.newPhaseEndDate" type="date" @keydown="handleKeydown"/>
            <input v-model="uiStore.newPhaseEndTime" type="time" @keydown="handleKeydown"/>
          </div>
        </div>

        <div v-if="dateWarning" class="warning">
          {{ dateWarning }}
        </div>
      </div>
      
      <div class="modal-footer">
        <button @click="uiStore.closePhaseModal" class="btn-secondary">
          Cancel
        </button>
        <button
          ref="submitBtn"
          @click="handleSubmit"
          class="btn-primary"
          :disabled="!uiStore.newPhaseName.trim()"
          @keydown.tab.exact.prevent="phaseNameInput?.focus()"
        >
          {{ uiStore.phaseModalMode === 'edit' ? 'Update' : 'Create' }}
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
  width: 25rem;
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
    
    .form-row {
      display: flex;
      gap: 1rem;

      .form-group {
        flex: 1;
      }
    }

    .warning {
      margin-top: 1rem;
      padding: 0.5rem;
      background: #4a2400;
      border: 1px solid #ffa566;
      border-radius: 0.1875rem;
      color: #ffa566;
      font-size: 0.9rem;
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