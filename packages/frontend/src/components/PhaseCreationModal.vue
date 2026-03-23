<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import type { Phase } from 'shared'
import { useUIStore } from '../stores/ui'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import { timestampToLocalDate, timestampToLocalTime, localDateTimeToTimestamp } from 'shared'
import TimePicker from './TimePicker.vue'
import PhaseSearchModal from './PhaseSearchModal.vue'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()

const phaseNameInput = ref<HTMLInputElement>()
const submitBtn = ref<HTMLButtonElement>()
const dateWarning = ref<string>('')
const focusedField = ref<string | null>(null)
const showPhaseSearch = ref(false)
const selectedParentName = ref<string>('Root (No Parent)')
const parentSelectorBtn = ref<HTMLButtonElement>()
const parentSelectorDisplay = ref<HTMLDivElement>()

const startTimestamp = computed(() => localDateTimeToTimestamp(modalStore.newPhaseStartDate, modalStore.newPhaseStartTime))
const endTimestamp = computed(() => localDateTimeToTimestamp(modalStore.newPhaseEndDate, modalStore.newPhaseEndTime))
const isRangeInvalid = computed(() => startTimestamp.value > endTimestamp.value)

const createPhase = async () => {
  if (!modalStore.newPhaseName.trim()) return

  try {
    const columnIndex = uiStore.selectedColumn
    let parentPhaseId: string | null = null
    if (columnIndex > 0) {
      parentPhaseId = uiStore.getSelectedPhaseId(columnIndex - 1) ?? null
    }

    await dataStore.createAndSelectPhase(projectStore.projectPath, {
      name: modalStore.newPhaseName.trim(),
      from: localDateTimeToTimestamp(modalStore.newPhaseStartDate, modalStore.newPhaseStartTime),
      to: localDateTimeToTimestamp(modalStore.newPhaseEndDate, modalStore.newPhaseEndTime),
      parent: parentPhaseId,
      commitments: []
    }, columnIndex)
    modalStore.closePhaseModal()
  } catch (error) {
    console.error('Failed to create phase:', error)
  }
}

const updatePhase = async () => {
  if (!modalStore.newPhaseName.trim()) return
  if (!modalStore.phaseModalEditingPhaseId) return

  try {
    const oldPhase = dataStore.phases[modalStore.phaseModalEditingPhaseId]
    const oldParentId = oldPhase?.parent ?? null

    const updatedPhase = await trpc.phase.update.mutate({
      projectPath: projectStore.projectPath,
      phaseId: modalStore.phaseModalEditingPhaseId,
      phase: {
        name: modalStore.newPhaseName.trim(),
        from: localDateTimeToTimestamp(modalStore.newPhaseStartDate, modalStore.newPhaseStartTime),
        to: localDateTimeToTimestamp(modalStore.newPhaseEndDate, modalStore.newPhaseEndTime),
        parent: modalStore.phaseModalEditingParentId
      }
    })

    // Update the local store with the updated phase
    if (updatedPhase) {
      dataStore.phases[updatedPhase.id] = updatedPhase
      
      // Reload the new parent's children
      await dataStore.loadPhases(projectStore.projectPath, updatedPhase.parent)
      
      // If parent changed, reload the old parent's children too to remove the ghost entry
      if (oldParentId !== updatedPhase.parent) {
        await dataStore.loadPhases(projectStore.projectPath, oldParentId)
      }

      // Rebuild visible phase columns from root selection to avoid stale column caches.
      // This ensures moved phases appear immediately in the destination sibling column.
      const rootPhases = dataStore.getPhasesByParentId(null)
      if (rootPhases.length > 0) {
        const previousFocusedColumn = uiStore.selectedColumn
        const selectedRootId = uiStore.getSelectedPhaseId(0)
        const fallbackRootIndex = uiStore.selectedPhaseByColumn[0] ?? 0
        const selectedRootIndex = selectedRootId
          ? rootPhases.findIndex((p) => p.id === selectedRootId)
          : fallbackRootIndex
        const clampedRootIndex = Math.min(
          Math.max(selectedRootIndex >= 0 ? selectedRootIndex : fallbackRootIndex, 0),
          rootPhases.length - 1
        )

        await uiStore.selectPhase(0, clampedRootIndex)
        uiStore.setSelectedColumn(Math.min(previousFocusedColumn, uiStore.rightmostColumnIndex))
        uiStore.ensureSelectionVisible()
      }
    }

    modalStore.closePhaseModal()
  } catch (error) {
    console.error('Failed to update phase:', error)
  }
}

const handleSubmit = () => {
  if (modalStore.phaseModalMode === 'edit') {
    updatePhase()
  } else {
    createPhase()
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    handleSubmit()
  } else if (event.key === 'Escape') {
    modalStore.closePhaseModal()
  }
}

// Calculate smart date ranges when modal opens (only for create mode)
watch(() => modalStore.showPhaseModal, async (newVal) => {
  if (newVal) {
    if (modalStore.phaseModalMode === 'create') {
      await calculateSmartDateRanges()
      await nextTick()
      phaseNameInput.value?.focus()
    } else if (modalStore.phaseModalMode === 'edit') {
      // Resolve parent name
      if (modalStore.phaseModalEditingParentId) {
          try {
              const p = await trpc.phase.get.query({ 
                  projectPath: projectStore.projectPath,
                  phaseId: modalStore.phaseModalEditingParentId
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
          projectPath: projectStore.projectPath,
          phaseId: selectedPhaseId
        })
        if (selectedPhase) {
          // Extract local date and time from timestamps
          modalStore.newPhaseStartDate = timestampToLocalDate(selectedPhase.from) || ''
          modalStore.newPhaseStartTime = timestampToLocalTime(selectedPhase.from) || ''
          modalStore.newPhaseEndDate = timestampToLocalDate(selectedPhase.to) || ''
          modalStore.newPhaseEndTime = timestampToLocalTime(selectedPhase.to) || ''
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
          projectPath: projectStore.projectPath,
          phaseId: parentPhaseIdFromColumn
        })
        if (parentPhase) {
          // Use backend smart calculation
          try {
            const suggestion = await trpc.phase.suggestSubPhaseConfig.query({
              projectPath: projectStore.projectPath,
              parentPhaseId: parentPhase.id
            })

            console.log('[PhaseCreation] Smart Suggestion:', suggestion, 
              'Start:', timestampToLocalDate(suggestion.from), timestampToLocalTime(suggestion.from),
              'End:', timestampToLocalDate(suggestion.to), timestampToLocalTime(suggestion.to)
            );
            
            modalStore.newPhaseStartDate = timestampToLocalDate(suggestion.from)
            modalStore.newPhaseStartTime = timestampToLocalTime(suggestion.from)
            modalStore.newPhaseEndDate = timestampToLocalDate(suggestion.to)
            modalStore.newPhaseEndTime = timestampToLocalTime(suggestion.to)
          } catch (e) {
            console.error('Failed to get smart dates:', e)
            // Fallback to parent bounds
            modalStore.newPhaseStartDate = timestampToLocalDate(parentPhase.from)
            modalStore.newPhaseStartTime = timestampToLocalTime(parentPhase.from)
            modalStore.newPhaseEndDate = timestampToLocalDate(parentPhase.to)
            modalStore.newPhaseEndTime = timestampToLocalTime(parentPhase.to)
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
  modalStore.newPhaseStartDate = now.toISOString().split('T')[0] || '' // YYYY-MM-DD
  modalStore.newPhaseStartTime = '00:00'
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  modalStore.newPhaseEndDate = sevenDaysLater.toISOString().split('T')[0] || ''
  modalStore.newPhaseEndTime = '00:00'
}

const onParentSelected = (payload: PhaseSearchSelection) => {
    if (payload.type !== 'phase') {
        return
    }

    const phase = payload.data
    // Check for self-reference
    if (modalStore.phaseModalMode === 'edit' && phase.id === modalStore.phaseModalEditingPhaseId) {
        alert("Cannot set phase as its own parent.")
        return
    }
    
    // Cycle check (simple depth check or rely on backend? Let's rely on backend check or user common sense for now to be fast)
    // TODO: Implement cycle check
    
    modalStore.phaseModalEditingParentId = phase.id
    selectedParentName.value = phase.name
}

const clearParent = () => {
    modalStore.phaseModalEditingParentId = null
    selectedParentName.value = 'Root (No Parent)'
}

const handleSearchClose = () => {
    showPhaseSearch.value = false
    nextTick(() => {
        // Focus back on the appropriate element
        if (modalStore.phaseModalEditingParentId) {
            parentSelectorDisplay.value?.focus()
        } else {
            parentSelectorBtn.value?.focus()
        }
    })
}
</script>

<template>
  <div v-if="modalStore.showPhaseModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3>{{ modalStore.phaseModalMode === 'edit' ? 'Edit Phase' : 'Create New Phase' }}</h3>
      </div>
      
      <div class="modal-body">
        <div class="form-group">
          <label>Phase Name</label>
          <input 
            ref="phaseNameInput"
            v-model="modalStore.newPhaseName"
            type="text" 
            placeholder="Enter phase name"
            @keydown.enter="handleKeydown"
            @keydown.esc="handleKeydown"
            @keydown.shift.tab.exact.prevent="submitBtn?.focus()"
          />
        </div>

        <div v-if="modalStore.phaseModalMode === 'edit'" class="form-group">
          <label>Parent Phase</label>
          
          <button 
            v-if="!modalStore.phaseModalEditingParentId"
            ref="parentSelectorBtn"
            class="btn-select-parent"
            @click="showPhaseSearch = true"
            @keydown.space.prevent="showPhaseSearch = true"
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
            @keydown.space.prevent="showPhaseSearch = true"
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
              v-model="modalStore.newPhaseStartDate"
              type="date" 
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('start') }"
              @keydown="handleKeydown"
              @focus="focusedField = 'startDate'"
              @blur="focusedField = null"
            />
            <TimePicker
              v-model="modalStore.newPhaseStartTime"
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('start') }"
              @keydown.native="handleKeydown"
              @focus="focusedField = 'startTime'"
              @blur="focusedField = null"
            />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input 
              v-model="modalStore.newPhaseEndDate"
              type="date" 
              :class="{ 'invalid-range': isRangeInvalid && !focusedField?.startsWith('end') }"
              @keydown="handleKeydown"
              @focus="focusedField = 'endDate'"
              @blur="focusedField = null"
            />
            <TimePicker
              v-model="modalStore.newPhaseEndTime"
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
        <button @click="modalStore.closePhaseModal" class="btn-secondary">
          Cancel
        </button>
        <button
          ref="submitBtn"
          @click="handleSubmit"
          class="btn-primary"
          :disabled="!modalStore.newPhaseName.trim() || isRangeInvalid"
          @keydown.tab.exact.prevent="phaseNameInput?.focus()"
        >
          {{ modalStore.phaseModalMode === 'edit' ? 'Update' : 'Create' }}
        </button>
      </div>
    </div>
    
    <PhaseSearchModal 
        v-if="showPhaseSearch" 
        :exclude-phase-id="modalStore.phaseModalEditingPhaseId"
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
