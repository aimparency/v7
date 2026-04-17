<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useUIStore } from '../stores/ui'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import PhaseSearchModal from './PhaseSearchModal.vue'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()

const phaseNameInput = ref<HTMLInputElement>()
const submitBtn = ref<HTMLButtonElement>()
const showPhaseSearch = ref(false)
const selectedParentName = ref<string>('Root (No Parent)')
const parentSelectorBtn = ref<HTMLButtonElement>()
const parentSelectorDisplay = ref<HTMLDivElement>()

const getSelectedLevelEntry = (columnIndex: number) => {
  const entries = dataStore.getSelectableColumnEntries(columnIndex)
  const selectedIndex = uiStore.getSelectedPhase(columnIndex)
  return entries[selectedIndex] ?? entries[0]
}

const createPhase = async () => {
  if (!modalStore.newPhaseName.trim()) return

  try {
    const columnIndex = uiStore.activeColumn
    const selectedEntry = getSelectedLevelEntry(columnIndex)
    const parentPhaseId = selectedEntry?.parentPhaseId ?? null
    let order = 0

    if (selectedEntry) {
      if (selectedEntry.type === 'phase') {
        const siblingIndex = dataStore.getPhaseSiblingIndex(parentPhaseId, selectedEntry.phase.id)
        if (siblingIndex >= 0) {
          order = siblingIndex + (modalStore.phaseModalInsertPosition === 'after' ? 1 : 0)
        }
      } else {
        order = 0
      }
    }

    await dataStore.createAndSelectPhase(projectStore.projectPath, {
      name: modalStore.newPhaseName.trim(),
      from: 0,
      to: 0,
      order,
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
        parent: modalStore.phaseModalEditingParentId
      }
    })

    if (updatedPhase) {
      dataStore.phases[updatedPhase.id] = updatedPhase
      await dataStore.loadPhases(projectStore.projectPath, updatedPhase.parent, { force: true })

      if (oldParentId !== updatedPhase.parent) {
        await dataStore.loadPhases(projectStore.projectPath, oldParentId, { force: true })
      }

      const rootEntries = dataStore.getSelectableColumnEntries(0)
      const rootPhases = rootEntries.filter((entry) => entry.type === 'phase').map((entry) => entry.phase)
      if (rootPhases.length > 0) {
        const previousFocusedColumn = uiStore.activeColumn
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
        uiStore.setActiveColumn(Math.min(previousFocusedColumn, uiStore.maxColumn))
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

watch(() => modalStore.showPhaseModal, async (newVal) => {
  if (newVal) {
    if (modalStore.phaseModalMode === 'create') {
      const selectedEntry = getSelectedLevelEntry(uiStore.activeColumn)
      selectedParentName.value = selectedEntry?.parentPhaseId
        ? (dataStore.phases[selectedEntry.parentPhaseId]?.name || 'Unknown Parent')
        : 'Root (No Parent)'
      await nextTick()
      phaseNameInput.value?.focus()
    } else if (modalStore.phaseModalMode === 'edit') {
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

const onParentSelected = (payload: PhaseSearchSelection) => {
  if (payload.type !== 'phase') {
    return
  }

  const phase = payload.data
  if (modalStore.phaseModalMode === 'edit' && phase.id === modalStore.phaseModalEditingPhaseId) {
    alert('Cannot set phase as its own parent.')
    return
  }

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
    if (modalStore.phaseModalEditingParentId) {
      parentSelectorDisplay.value?.focus()
    } else {
      parentSelectorBtn.value?.focus()
    }
  })
}
</script>

<template>
  <FormModalShell
    :show="modalStore.showPhaseModal"
    :title="modalStore.phaseModalMode === 'edit' ? 'Edit Phase' : 'Create New Phase'"
    :entity-id="modalStore.phaseModalMode === 'edit' ? modalStore.phaseModalEditingPhaseId : null"
    @request-close="modalStore.closePhaseModal()"
  >
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

    <div v-if="modalStore.phaseModalMode === 'create'" class="phase-insert-hint">
      {{
        modalStore.phaseModalInsertPosition === 'after'
          ? 'New phase will be inserted after the selected item on this level.'
          : 'New phase will be inserted before the selected item on this level.'
      }}
    </div>

    <template #footer>
      <button @click="modalStore.closePhaseModal" class="btn-secondary">
        Cancel
      </button>
      <button
        ref="submitBtn"
        @click="handleSubmit"
        class="btn-primary"
        :disabled="!modalStore.newPhaseName.trim()"
        @keydown.tab.exact.prevent="phaseNameInput?.focus()"
      >
        {{ modalStore.phaseModalMode === 'edit' ? 'Update' : 'Create' }}
      </button>
    </template>
  </FormModalShell>

  <PhaseSearchModal
    v-if="showPhaseSearch"
    :exclude-phase-id="modalStore.phaseModalEditingPhaseId"
    @select="onParentSelected"
    @close="handleSearchClose"
  />
</template>

<style scoped>
.form-group {
  margin-bottom: 0.75rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.375rem;
  font-weight: bold;
  color: #ccc;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #007acc;
}

.form-group select {
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
}

.btn-select-parent:hover,
.btn-select-parent:focus {
  background: #444;
  border-color: #777;
  color: #fff;
  outline: none;
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
}

.parent-selector:hover,
.parent-selector:focus {
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
}

.btn-icon:hover {
  color: #ff4444;
  background: rgba(255, 68, 68, 0.1);
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.btn-primary {
  background: #007acc;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #005a99;
}

.btn-primary:disabled {
  background: #444;
  color: #666;
  cursor: not-allowed;
}

.btn-secondary {
  background: #444;
  color: #e0e0e0;
}

.btn-secondary:hover {
  background: #555;
}
</style>
