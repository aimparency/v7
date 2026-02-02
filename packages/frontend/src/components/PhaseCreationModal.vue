<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import type { Phase } from 'shared'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import { timestampToLocalDate, timestampToLocalTime, localDateTimeToTimestamp } from 'shared'
import TimePicker from './TimePicker.vue'
import PhaseSearchModal from './PhaseSearchModal.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()

const phaseNameInput = ref<HTMLInputElement>()
const submitBtn = ref<HTMLButtonElement>()
const dateWarning = ref<string>('')
const focusedField = ref<string | null>(null)
const showPhaseSearch = ref(false)
const selectedParentName = ref<string>('Root (No Parent)')
const parentSelectorBtn = ref<HTMLButtonElement>()
const parentSelectorDisplay = ref<HTMLDivElement>()

const startTimestamp = computed(() => localDateTimeToTimestamp(uiStore.newPhaseStartDate, uiStore.newPhaseStartTime))
const endTimestamp = computed(() => localDateTimeToTimestamp(uiStore.newPhaseEndDate, uiStore.newPhaseEndTime))
const isRangeInvalid = computed(() => startTimestamp.value > endTimestamp.value)

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
      // Resolve parent name
      if (uiStore.phaseModalEditingParentId) {
          try {
              const p = await trpc.phase.get.query({ 
                  projectPath: uiStore.projectPath, 
                  phaseId: uiStore.phaseModalEditingParentId 
              })
              selectedParentName.value = p.name
          } catch {
              selectedParentName.value = 'Unknown Parent'
          }
      } else {
          selectedParentName.value = 'Root (No Parent)'
      }
      await nextTick()
      phaseNameInput.value?.focus()
    }
  }
})

const calculateSmartDateRanges = async () => {
  dateWarning.value = ''
  console.log('[PhaseCreation] Calc Smart Dates. Col:', uiStore.selectedColumn)
  
  // Priority 1: Copy from currently selected phase (Only for root phases - Column 0)
  // For sub-phases, we prefer Priority 2 (Smart Logic from Parent)
  if (uiStore.selectedColumn === 0) {
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
  if (uiStore.selectedColumn > 0) {
    const parentColumn = uiStore.selectedColumn - 1
    const parentPhaseIdFromColumn = uiStore.getSelectedPhaseId(parentColumn)
    if (parentPhaseIdFromColumn) {
      try {
        const parentPhase = await trpc.phase.get.query({
          projectPath: uiStore.projectPath,
          phaseId: parentPhaseIdFromColumn
        })
        if (parentPhase) {
          // Use backend smart calculation
          try {
            const suggestion = await trpc.phase.suggestSubPhaseConfig.query({
              projectPath: uiStore.projectPath,
              parentPhaseId: parentPhase.id
            })

            console.log('[PhaseCreation] Smart Suggestion:', suggestion, 
              'Start:', timestampToLocalDate(suggestion.from), timestampToLocalTime(suggestion.from),
              'End:', timestampToLocalDate(suggestion.to), timestampToLocalTime(suggestion.to)
            );
            
            uiStore.newPhaseStartDate = timestampToLocalDate(suggestion.from)
            uiStore.newPhaseStartTime = timestampToLocalTime(suggestion.from)
            uiStore.newPhaseEndDate = timestampToLocalDate(suggestion.to)
            uiStore.newPhaseEndTime = timestampToLocalTime(suggestion.to)
          } catch (e) {
            console.error('Failed to get smart dates:', e)
            // Fallback to parent bounds
            uiStore.newPhaseStartDate = timestampToLocalDate(parentPhase.from)
            uiStore.newPhaseStartTime = timestampToLocalTime(parentPhase.from)
            uiStore.newPhaseEndDate = timestampToLocalDate(parentPhase.to)
            uiStore.newPhaseEndTime = timestampToLocalTime(parentPhase.to)
          }
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

const onParentSelected = (phase: Phase) => {
    // Check for self-reference
    if (uiStore.phaseModalMode === 'edit' && phase.id === uiStore.phaseModalEditingPhaseId) {
        alert("Cannot set phase as its own parent.")
        return
    }
    
    // Cycle check (simple depth check or rely on backend? Let's rely on backend check or user common sense for now to be fast)
    // TODO: Implement cycle check
    
    uiStore.phaseModalEditingParentId = phase.id
    selectedParentName.value = phase.name
}

const clearParent = () => {
    uiStore.phaseModalEditingParentId = null
    selectedParentName.value = 'Root (No Parent)'
}

const handleSearchClose = () => {
    showPhaseSearch.value = false
    nextTick(() => {
        // Focus back on the appropriate element
        if (uiStore.phaseModalEditingParentId) {
            parentSelectorDisplay.value?.focus()
        } else {
            parentSelectorBtn.value?.focus()
        }
    })
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
          
          <button 
            v-if="!uiStore.phaseModalEditingParentId" 
            ref="parentSelectorBtn"
            class="btn-select-parent"
            @click="showPhaseSearch = true"
            @keydown.esc="handleKeydown"
          >
            + Add Parent Phase
          </button>
          
          <div 
            v-else
            ref="parentSelectorDisplay"
            class="parent-selector" 
            @click="showPhaseSearch = true" 
            tabindex="0" 
            @keydown.enter="showPhaseSearch = true"
            @keydown.esc="handleKeydown"
          >
              <div class="selected-parent">{{ selectedParentName }}</div>
              <div class="parent-actions">
                <button @click.stop="clearParent" class="btn-icon btn-danger" title="Clear parent">✕</button>
              </div>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input 
              v-model="uiStore.newPhaseStartDate" 
              type="date" 
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('start') }"
              @keydown="handleKeydown"
              @focus="focusedField = 'startDate'"
              @blur="focusedField = null"
            />
            <TimePicker
              v-model="uiStore.newPhaseStartTime" 
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('start') }"
              @keydown.native="handleKeydown"
              @focus="focusedField = 'startTime'"
              @blur="focusedField = null"
            />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input 
              v-model="uiStore.newPhaseEndDate" 
              type="date" 
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('end') }"
              @keydown="handleKeydown"
              @focus="focusedField = 'endDate'"
              @blur="focusedField = null"
            />
            <TimePicker
              v-model="uiStore.newPhaseEndTime" 
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('end') }"
              @keydown.native="handleKeydown"
              @focus="focusedField = 'endTime'"
              @blur="focusedField = null"
            />
          </div>
        </div>

        <div v-if="isRangeInvalid" class="warning">
          Start date must be before end date.
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
          :disabled="!uiStore.newPhaseName.trim() || isRangeInvalid"
          @keydown.tab.exact.prevent="phaseNameInput?.focus()"
        >
          {{ uiStore.phaseModalMode === 'edit' ? 'Update' : 'Create' }}
        </button>
      </div>
    </div>
    
    <PhaseSearchModal 
        v-if="showPhaseSearch" 
        :exclude-phase-id="uiStore.phaseModalEditingPhaseId"
        @select="onParentSelected" 
        @close="handleSearchClose" 
    />
  </div>
</template>

<style scoped>
.invalid-range {
  border-color: #ff4444 !important;
  background-color: rgba(255, 0, 0, 0.1) !important;
}

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
  max-height: 90vh;
  display: flex;
  flex-direction: column;

  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid #555;
    flex-shrink: 0;
    
    h3 {
      margin: 0;
    }
  }
  
  .modal-body {
    padding: 1rem;
    flex: 1;
    overflow-y: auto;
    
    .form-group {
      margin-bottom: 1rem;
      
      label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: bold;
        color: #ccc;
      }
      
      select {
        cursor: pointer;
      }

      .btn-select-parent {
          width: 100%;
          padding: 0.5rem;
          background: #333;
          border: 1px dashed #555;
          color: #aaa;
          border-radius: 0.1875rem;
          cursor: pointer;
          transition: all 0.2s;

          &:hover, &:focus {
              background: #444;
              border-color: #777;
              color: #fff;
              outline: none;
          }
      }

      .parent-selector {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #1a1a1a;
          border: 1px solid #555;
          padding: 0.5rem;
          border-radius: 0.1875rem;
          cursor: pointer;
          transition: border-color 0.2s;

          &:hover, &:focus {
             border-color: #007acc;
             outline: none;
          }

          .selected-parent {
              color: #e0e0e0;
              flex: 1;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-right: 10px;
          }

          .parent-actions {
              display: flex;
              gap: 8px;
              align-items: center;
          }

          .btn-icon {
              background: transparent;
              border: none;
              color: #888;
              font-size: 1rem;
              cursor: pointer;
              padding: 0 4px;
              border-radius: 3px;

              &:hover {
                  color: #ff4444;
                  background: rgba(255, 68, 68, 0.1);
              }
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
    flex-shrink: 0;
    
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