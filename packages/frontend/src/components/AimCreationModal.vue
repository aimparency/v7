<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import type { Aim, AimStatusState, SearchAimResult } from 'shared'
import TagInput from './TagInput.vue'
import { AIM_DEFAULTS } from '../constants/aimDefaults'
import AimSearchPicker from './AimSearchPicker.vue'
import NumericTextInput from './NumericTextInput.vue'
import type { AimSearchAdditionalOption } from '../stores/ui/aim-search-types'

const uiStore = useUIStore()
const dataStore = useDataStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()

const aimText = ref(AIM_DEFAULTS.text)
const aimDescription = ref(AIM_DEFAULTS.description)
const aimIntrinsicValue = ref(AIM_DEFAULTS.intrinsicValue)
const aimCost = ref(AIM_DEFAULTS.cost)
const aimLoopWeight = ref(AIM_DEFAULTS.loopWeight)
const aimTags = ref<string[]>([...AIM_DEFAULTS.tags])
const selectedStatus = ref<AimStatusState>(AIM_DEFAULTS.status.state)
const statusComment = ref(AIM_DEFAULTS.status.comment)
const supportedAimsList = ref<{ id: string, text: string, weight: number }[]>([])
const supportingConnectionsList = ref<{ id: string, text: string, weight: number }[]>([])
const searchSelection = ref<{ type: 'aim'; data: SearchAimResult } | { type: 'option'; data: AimSearchAdditionalOption } | null>(null)
const aimSearchPicker = ref<InstanceType<typeof AimSearchPicker>>()

const availableStatuses = computed(() => dataStore.getStatuses)
const aimTextInput = ref<HTMLInputElement>()
const descriptionInput = ref<HTMLTextAreaElement>()
const intrinsicValueInput = ref<HTMLInputElement>()
const costInput = ref<HTMLInputElement>()
const loopWeightInput = ref<HTMLInputElement>()
const statusSelect = ref<HTMLSelectElement>()
const statusCommentInput = ref<HTMLInputElement>()
const addParentBtn = ref<HTMLButtonElement>()
const submitBtn = ref<HTMLButtonElement>()

const currentAimId = computed(() => {
  if (modalStore.aimModalMode !== 'edit') return null
  return uiStore.getCurrentAim()?.id ?? null
})

const openParentSearch = () => {
  modalStore.openAimSearch('pick', (payload) => {
    if (payload.type !== 'aim') return
    const aim = payload.data
    if (!supportedAimsList.value.some(a => a.id === aim.id)) {
      supportedAimsList.value.push({ id: aim.id, text: aim.text, weight: 1 })
    }
  }, undefined, {
    title: 'Select Supported Aim',
    placeholder: 'Search for a parent aim...'
  })
}

const openChildSearch = () => {
  modalStore.openAimSearch('pick', (payload) => {
    if (payload.type !== 'aim') return
    const aim = payload.data
    if (!supportingConnectionsList.value.some(a => a.id === aim.id)) {
      supportingConnectionsList.value.push({ id: aim.id, text: aim.text, weight: 1 })
    }
  }, undefined, {
    title: 'Select Supporting Aim',
    placeholder: 'Search for a child aim...'
  })
}

const removeParent = (index: number) => {
  supportedAimsList.value.splice(index, 1)
}

const removeChild = (index: number) => {
  supportingConnectionsList.value.splice(index, 1)
}

const selectedSearchResult = computed(() => {
  return searchSelection.value?.type === 'aim' ? searchSelection.value.data : null
})

const hasSearchText = computed(() => aimText.value.trim().length > 0)
const createNewOption = computed<AimSearchAdditionalOption[]>(() => {
  if (!hasSearchText.value) return []
  return [{ id: 'create-new', label: `Create new: "${aimText.value}"` }]
})

const createAim = async () => {
  if (!aimText.value.trim() && !selectedSearchResult.value) return

  const weight = supportedAimsList.value.length > 0 ? (supportedAimsList.value[0]?.weight ?? 1) : 1

  try {
    if (selectedSearchResult.value) {
      // Link existing aim
      await uiStore.createAim(selectedSearchResult.value.id, true, undefined, undefined, 0, 1, 1, weight)
    } else {
      // Create new aim with text and description
      await uiStore.createAim(
        aimText.value.trim(), 
        false, 
        aimDescription.value.trim(), 
        aimTags.value, 
        aimIntrinsicValue.value, 
        aimLoopWeight.value,
        aimCost.value,
        weight,
        supportedAimsList.value.map(a => a.id),
        supportingConnectionsList.value.map(a => ({ aimId: a.id, weight: a.weight }))
      )
    }
  } catch (error) {
    console.error('Failed to create/link aim:', error)
  }
}

const updateAim = async () => {
  const aim = uiStore.getCurrentAim()

  if(aim) {
    await dataStore.updateAim(projectStore.projectPath, aim.id, {
      text: aimText.value.trim(),
      description: aimDescription.value.trim(),
      tags: aimTags.value,
      status: {
        state: selectedStatus.value,
        comment: statusComment.value,
        date: Date.now()
      },
      intrinsicValue: aimIntrinsicValue.value,
      cost: aimCost.value,
      loopWeight: aimLoopWeight.value,
      supportedAims: supportedAimsList.value.map(a => a.id)
    })

    modalStore.closeAimModal()
  } else {
    console.error('Failed to update aim: no current aim')
  }
}

const handleSubmit = () => {
  if (modalStore.aimModalMode === 'edit') {
    updateAim()
  } else {
    createAim()
  }
}

const handleInputKeydown = (event: KeyboardEvent) => {
  if (
    event.key === 'Tab' &&
    !event.shiftKey &&
    modalStore.aimModalMode === 'create' &&
    hasSearchText.value
  ) {
    event.preventDefault()
    aimSearchPicker.value?.focusSelectedResult()
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    handleSubmit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation() // Prevent escape from bubbling to global handler
    modalStore.closeAimModal()
  }
}

const handleTextareaKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    handleSubmit()
  } else if (event.key === 'Escape') {
    // Vim-friendly: Esc blurs the field (exits "insert mode") instead of closing modal
    event.preventDefault()
    event.stopPropagation()
    descriptionInput.value?.blur()
  }
}

const handleSearchActivate = (
  payload: { type: 'aim'; data: SearchAimResult } | { type: 'option'; data: AimSearchAdditionalOption }
) => {
  searchSelection.value = payload
  handleSubmit()
}

const focusAimTextInput = () => {
  aimTextInput.value?.focus()
}

const handleTagPrev = () => {
  if (modalStore.aimModalMode === 'edit') {
    statusCommentInput.value?.focus()
  } else {
    loopWeightInput.value?.focus()
  }
}

const handleTagNext = () => {
  submitBtn.value?.focus()
}

const handleLoopWeightNext = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    if (modalStore.aimModalMode === 'edit') {
      statusSelect.value?.focus()
    } else {
      // Tags? TagInput doesn't have a focus method easily accessible here 
      // but I can try to find the input inside it.
      // Better: let's just use the @next-field logic if I can.
      // For now, I'll just let default tab work if I don't prevent it?
      // But I want consistent control.
      document.querySelector<HTMLElement>('.tag-input-container input')?.focus()
    }
  }
}

const handleStatusCommentNext = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    addParentBtn.value?.focus()
  }
}

const handleModalKeydown = (event: KeyboardEvent) => {
  if (modalStore.aimModalMode !== 'edit' || event.key !== 'Enter') return

  const target = event.target as HTMLElement | null
  if (!target) return

  // Do not submit on multiline fields or tag entry.
  if (
    target instanceof HTMLTextAreaElement ||
    target.closest('.tag-input-container')
  ) {
    return
  }

  // Submit from standard edit fields.
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement
  ) {
    event.preventDefault()
    event.stopPropagation()
    handleSubmit()
  }
}

onMounted(async () => {
  let aim
  supportedAimsList.value = []

  if (modalStore.aimModalMode === 'edit') {
    aim = uiStore.getCurrentAim()
  } else {
    // Create mode: identify potential parent
    const path = uiStore.getSelectionPath()
    if (path.aims.length > 0) {
        let parentAim: Aim | undefined
        const currentAim = path.aims[path.aims.length - 1]
        
        if (currentAim && currentAim.expanded && modalStore.aimModalInsertPosition === 'after') {
            parentAim = currentAim
        } else if (path.aims.length > 1) {
            parentAim = path.aims[path.aims.length - 2]
        }
        
        if (parentAim) {
            supportedAimsList.value.push({
                id: parentAim.id,
                text: parentAim.text,
                weight: 1
            })
        }
    }
  }

  console.log('Loaded aim for editing:', aim) 

  if (aim) {
    aimText.value = aim.text
    aimDescription.value = aim.description || ''
    aimTags.value = [...(aim.tags || [])]
    aimIntrinsicValue.value = aim.intrinsicValue ?? 0
    aimCost.value = aim.cost ?? 0
    aimLoopWeight.value = aim.loopWeight ?? 0
    selectedStatus.value = aim.status.state
    statusComment.value = aim.status.comment

    // Load supported aims (Parents) to prevent data loss
    if (aim.supportedAims && aim.supportedAims.length > 0) {
      try {
        const parents = await trpc.aim.list.query({
          projectPath: projectStore.projectPath,
          ids: aim.supportedAims
        })
        supportedAimsList.value = parents.map(p => ({
          id: p.id,
          text: p.text,
          weight: 1 // Placeholder weight as we can't easily fetch inbound weight
        }))
      } catch (e) {
        console.error("Failed to load supported aims", e)
      }
    }
  } else {
    // Reset for create mode using defaults
    aimText.value = AIM_DEFAULTS.text
    aimDescription.value = AIM_DEFAULTS.description
    aimTags.value = [...AIM_DEFAULTS.tags]
    aimIntrinsicValue.value = AIM_DEFAULTS.intrinsicValue
    aimCost.value = AIM_DEFAULTS.cost
    aimLoopWeight.value = AIM_DEFAULTS.loopWeight
    selectedStatus.value = AIM_DEFAULTS.status.state
    statusComment.value = AIM_DEFAULTS.status.comment
    searchSelection.value = null
  }
  await nextTick()
  aimTextInput.value?.focus()
})

</script>

<template>
  <FormModalShell
    :show="true"
    :title="modalStore.aimModalMode === 'edit' ? 'Edit Aim' : 'Add Aim'"
    :entity-id="currentAimId"
    @request-close="modalStore.closeAimModal()"
  >
    <div @keydown.capture="handleModalKeydown">
        <div class="form-group">
          <label>Aim Text</label>
          <input
            ref="aimTextInput"
            v-model="aimText"
            type="text"
            placeholder="Enter aim text"
            @keydown="handleInputKeydown"
            @keydown.shift.tab.exact.prevent="submitBtn?.focus()"
          />
        </div>

        <!-- Search Results (create mode only) -->
        <div
          v-if="modalStore.aimModalMode === 'create' && hasSearchText"
          class="search-results"
          @keydown.shift.tab.exact.prevent="focusAimTextInput"
        >
          <AimSearchPicker
            ref="aimSearchPicker"
            :query="aimText"
            :show-input="false"
            :show-filters="false"
            :additional-options="createNewOption"
            selection-behavior="unique-near-exact-aim"
            :activate-on-click="true"
            :activate-on-enter="true"
            :select-on-hover="false"
            :result-limit="5"
            @activate="handleSearchActivate"
            @escape="focusAimTextInput"
            @selection-change="searchSelection = $event"
          />

          <div class="search-help">
            Use <kbd>J</kbd>/<kbd>K</kbd> to navigate, <kbd>Enter</kbd> to submit
          </div>
        </div>

        <div class="form-group">
          <label>Description (optional)</label>
          <textarea
            ref="descriptionInput"
            v-model="aimDescription"
            placeholder="Enter aim description"
            rows="3"
            @keydown="handleTextareaKeydown"
          ></textarea>
        </div>

        <!-- Status fields (edit mode only) -->
        <div v-if="modalStore.aimModalMode === 'edit'">
          <div class="form-group">
            <label>Status</label>
                      <select
                        ref="statusSelect"
                        v-model="selectedStatus"
                        class="status-select"
                        @keydown="handleInputKeydown"
                      >
                        <option v-for="status in availableStatuses" :key="status.key" :value="status.key">
                          {{ status.key }}
                        </option>
                      </select>
                    </div>
                    <div class="form-group">            <label>Status Comment (optional)</label>
            <input
              ref="statusCommentInput"
              v-model="statusComment"
              type="text"
              placeholder="Add a comment about the status"
              @keydown="handleInputKeydown"
              @keydown.tab.exact="handleStatusCommentNext"
            />
          </div>
        </div>

        <div class="form-group">
            <div class="label-row">
                <label>Supports (Parents)</label>
                <button ref="addParentBtn" @click="openParentSearch" class="btn-small" title="Add Parent">+</button>
            </div>
            <div v-for="(parent, index) in supportedAimsList" :key="parent.id" class="supported-aim-row">
                <span class="parent-text">{{ parent.text }}</span>
                <div class="weight-input">
                    <span class="weight-label">Weight:</span>
                    <NumericTextInput v-model="parent.weight" class="weight-field" @keydown="handleInputKeydown" />
                </div>
                <button @click="removeParent(index)" class="btn-remove" title="Remove Connection">×</button>
            </div>
        </div>

        <div class="form-group" v-if="modalStore.aimModalMode === 'create'">
            <div class="label-row">
                <label>Supporting (Children)</label>
                <button @click="openChildSearch" class="btn-small" title="Add Child">+</button>
            </div>
            <div v-for="(child, index) in supportingConnectionsList" :key="child.id" class="supported-aim-row">
                <span class="parent-text">{{ child.text }}</span>
                <div class="weight-input">
                    <span class="weight-label">Weight:</span>
                    <NumericTextInput v-model="child.weight" class="weight-field" @keydown="handleInputKeydown" />
                </div>
                <button @click="removeChild(index)" class="btn-remove" title="Remove Connection">×</button>
            </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Intrinsic Value</label>
            <input
              ref="intrinsicValueInput"
              v-model.number="aimIntrinsicValue"
              type="number"
              placeholder="0"
              @keydown="handleInputKeydown"
            />
          </div>

          <div class="form-group">
            <label>Cost</label>
            <input
              ref="costInput"
              v-model.number="aimCost"
              type="number"
              placeholder="0"
              @keydown="handleInputKeydown"
            />
          </div>

          <div class="form-group">
            <label>Loop Weight</label>
            <input
              ref="loopWeightInput"
              v-model.number="aimLoopWeight"
              type="number"
              placeholder="0"
              @keydown="handleInputKeydown"
              @keydown.tab.exact="handleLoopWeightNext"
            />
          </div>
        </div>

        <div class="form-group">
          <TagInput 
            v-model="aimTags" 
            label="Tags" 
            @next-field="handleTagNext"
            @prev-field="handleTagPrev"
          />
        </div>
    </div>
      
    <template #footer>
        <button @click="modalStore.closeAimModal" class="btn-secondary">
          Cancel
        </button>
        <button
          ref="submitBtn"
          @click="handleSubmit"
          class="btn-primary"
          :disabled="!aimText.trim() && !selectedSearchResult"
          @keydown.tab.exact.prevent="aimTextInput?.focus()"
        >
          {{ modalStore.aimModalMode === 'edit' ? 'Update' : (selectedSearchResult ? 'Link Existing' : 'Create New') }}
        </button>
    </template>
  </FormModalShell>
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
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #007acc;
}

.form-group input::placeholder,
.form-group textarea::placeholder {
  color: #666;
}

.form-group textarea {
  resize: vertical;
}

.form-group select {
  cursor: pointer;
}

.form-row {
  display: flex;
  gap: 0.75rem;
}

.form-row .form-group {
  flex: 1;
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.1875rem;
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

.search-results {
  max-height: 12.5rem;
  overflow-y: auto;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  background: #1a1a1a;
  margin-bottom: 1rem;

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
      &.unclear { color: var(--status-unclear); }
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
    }
  }
}

.supported-aim-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #252525;
    padding: 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border: 1px solid #444;
}

.parent-text {
    font-weight: 500;
    color: #ddd;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 1rem;
}

.weight-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.weight-label {
    font-size: 0.8rem;
    color: #888;
}

.weight-field {
    width: 60px !important;
    padding: 0.2rem 0.4rem !important;
    text-align: center;
}

.label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
}

.btn-small {
    background: #444;
    border: 1px solid #555;
    color: #fff;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    line-height: 1;
    padding-bottom: 3px;
}

.btn-small:hover {
    background: #555;
    border-color: #666;
}

.btn-remove {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 1.2rem;
    padding: 0 0.5rem;
    margin-left: 0.5rem;
    line-height: 1;
}

.btn-remove:hover {
    color: #ff4444;
}
</style>
