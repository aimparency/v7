<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import type { Phase } from 'shared'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import { timestampToLocalDate, timestampToLocalTime, localDateTimeToTimestamp } from 'shared'

const uiStore = useUIStore()
const dataStore = useDataStore()

const phaseNameInput = ref<HTMLInputElement>()
const dateWarning = ref<string>('')

const emit = defineEmits<{
  phaseCreated: [columnIndex: number]
}>()


const createPhase = async () => {
  if (!uiStore.newPhaseName.trim()) return

  // Use the parent phase ID directly from the UI store
  const parentPhaseId = uiStore.phaseModalParentPhase

  try {
    await dataStore.createPhase(uiStore.projectPath, {
      name: uiStore.newPhaseName.trim(),
      from: localDateTimeToTimestamp(uiStore.newPhaseStartDate, uiStore.newPhaseStartTime),
      to: localDateTimeToTimestamp(uiStore.newPhaseEndDate, uiStore.newPhaseEndTime),
      parent: parentPhaseId,
      commitments: []
    })

    // Emit event so parent can reload the appropriate phase list
    const columnIndex = uiStore.phaseModalColumnIndex
    emit('phaseCreated', columnIndex)

    uiStore.closePhaseModal()
  } catch (error) {
    console.error('Failed to create phase:', error)
  }
}

const updatePhase = async () => {
  if (!uiStore.newPhaseName.trim()) return
  if (!uiStore.phaseModalEditingPhaseId) return

  try {
    await trpc.phase.update.mutate({
      projectPath: uiStore.projectPath,
      phaseId: uiStore.phaseModalEditingPhaseId,
      phase: {
        name: uiStore.newPhaseName.trim(),
        from: localDateTimeToTimestamp(uiStore.newPhaseStartDate, uiStore.newPhaseStartTime),
        to: localDateTimeToTimestamp(uiStore.newPhaseEndDate, uiStore.newPhaseEndTime),
      }
    })

    // Emit event so parent can reload the appropriate phase list
    const columnIndex = uiStore.phaseModalColumnIndex
    emit('phaseCreated', columnIndex)

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
  if (newVal && uiStore.phaseModalMode === 'create') {
    await calculateDateRanges()
    await nextTick()
    phaseNameInput.value?.focus()
  } else if (newVal && uiStore.phaseModalMode === 'edit') {
    await nextTick()
    phaseNameInput.value?.focus()
  }
})

const calculateDateRanges = async () => {
  dateWarning.value = ''
  const parentPhaseId = uiStore.phaseModalParentPhase

  // Root phase: 9 years from today
  if (parentPhaseId === null) {
    const now = Date.now()
    const nineYears = 9 * 365 * 24 * 60 * 60 * 1000

    uiStore.newPhaseStartDate = timestampToLocalDate(now)
    uiStore.newPhaseStartTime = timestampToLocalTime(now)
    uiStore.newPhaseEndDate = timestampToLocalDate(now + nineYears)
    uiStore.newPhaseEndTime = timestampToLocalTime(now + nineYears)

    return
  }

  // Child phase: calculate based on parent and siblings
  try {
    // Get parent phase
    const parentPhase = await trpc.phase.get.query({
      projectPath: uiStore.projectPath,
      phaseId: parentPhaseId
    })

    if (!parentPhase) {
      // Fallback to default
      const now = Date.now()
      const nineYears = 9 * 365 * 24 * 60 * 60 * 1000

      uiStore.newPhaseStartDate = timestampToLocalDate(now)
      uiStore.newPhaseStartTime = timestampToLocalTime(now)
      uiStore.newPhaseEndDate = timestampToLocalDate(now + nineYears)
      uiStore.newPhaseEndTime = timestampToLocalTime(now + nineYears)

      return
    }

    // Get sibling phases (sorted by 'from')
    const siblings = await trpc.phase.list.query({
      projectPath: uiStore.projectPath,
      parentPhaseId: parentPhaseId
    })
    const sortedSiblings = siblings.sort((a, b) => a.from - b.from)

    const parentDuration = parentPhase.to - parentPhase.from
    const phaseDuration = parentDuration / 7

    let startTime: number
    let endTime: number

    if (sortedSiblings.length === 0) {
      // First child: start at parent start
      startTime = parentPhase.from
      endTime = Math.min(startTime + phaseDuration, parentPhase.to)
    } else {
      // Subsequent child: start after last sibling
      const lastSibling = sortedSiblings[sortedSiblings.length - 1]
      startTime = lastSibling.to
      endTime = Math.min(startTime + phaseDuration, parentPhase.to)
    }

    // Clamp to parent range
    if (endTime > parentPhase.to) {
      endTime = parentPhase.to
    }

    // Warn if duration is 0
    if (endTime <= startTime) {
      dateWarning.value = 'Warning: No space left in parent phase for new phase!'
      endTime = startTime // Set to same time to show the issue
    }

    uiStore.newPhaseStartDate = timestampToLocalDate(startTime)
    uiStore.newPhaseStartTime = timestampToLocalTime(startTime)
    uiStore.newPhaseEndDate = timestampToLocalDate(endTime)
    uiStore.newPhaseEndTime = timestampToLocalTime(endTime)
  } catch (error) {
    console.error('Failed to calculate date ranges:', error)
    // Fallback to default
    const now = Date.now()
    const nineYears = 9 * 365 * 24 * 60 * 60 * 1000

    uiStore.newPhaseStartDate = timestampToLocalDate(now)
    uiStore.newPhaseStartTime = timestampToLocalTime(now)
    uiStore.newPhaseEndDate = timestampToLocalDate(now + nineYears)
    uiStore.newPhaseEndTime = timestampToLocalTime(now + nineYears)
  }
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
            @keydown="handleKeydown"
          />
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
          @click="handleSubmit"
          class="btn-primary"
          :disabled="!uiStore.newPhaseName.trim()"
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