<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import TagInput from './TagInput.vue'
import NumericTextInput from './NumericTextInput.vue'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'

const props = defineProps<{
  show: boolean
  aimId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const dataStore = useDataStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()

const aim = computed(() => {
  if (!props.aimId) return null
  return dataStore.aims[props.aimId] || null
})

const statuses = computed(() => dataStore.getStatuses)

const aimText = ref('')
const aimDescription = ref('')
const aimIntrinsicValue = ref(0)
const aimCost = ref(0)
const aimLoopWeight = ref(0)
const aimTags = ref<string[]>([])
const selectedStatus = ref('')
const statusComment = ref('')
const reflection = ref('')
const supportedAimsList = ref<{ id: string, text: string, weight: number }[]>([])
const committedPhasesList = ref<{ id: string, name: string }[]>([])
const confirmRemoveParentId = ref<string | null>(null)
const confirmRemovePhaseId = ref<string | null>(null)
const originalCommittedPhaseIds = ref<string[]>([])

const aimTextInput = ref<HTMLInputElement>()
const descriptionInput = ref<HTMLTextAreaElement>()
const statusCommentInput = ref<HTMLInputElement>()
const reflectionInput = ref<HTMLTextAreaElement>()
const loopWeightInput = ref<HTMLInputElement>()
const addParentBtn = ref<HTMLButtonElement>()
const addPhaseBtn = ref<HTMLButtonElement>()
const submitBtn = ref<HTMLButtonElement>()

const pendingFocusRestore = ref<'parent' | 'phase' | null>(null)

const openParentSearch = () => {
  pendingFocusRestore.value = 'parent'
  modalStore.openAimSearch('pick', (payload) => {
    if (payload.type !== 'aim') return
    const selectedAim = payload.data
    if (!supportedAimsList.value.some((entry) => entry.id === selectedAim.id)) {
      supportedAimsList.value.push({ id: selectedAim.id, text: selectedAim.text, weight: 1 })
    }
  }, undefined, {
    title: 'Select Supported Aim',
    placeholder: 'Search for a parent aim...'
  })
}

const openPhaseSearch = () => {
  pendingFocusRestore.value = 'phase'
  modalStore.openPhaseSearchPrompt((payload: PhaseSearchSelection) => {
    if (payload.type !== 'phase') return
    const phase = payload.data
    if (!committedPhasesList.value.some((entry) => entry.id === phase.id)) {
      committedPhasesList.value.push({ id: phase.id, name: phase.name })
    }
  }, {
    title: 'Commit In Phase',
    placeholder: 'Search for a phase...'
  })
}

const removeParent = (parentId: string) => {
  if (confirmRemoveParentId.value !== parentId) {
    confirmRemoveParentId.value = parentId
    return
  }

  supportedAimsList.value = supportedAimsList.value.filter((parent) => parent.id !== parentId)
  confirmRemoveParentId.value = null
}

const removeCommittedPhase = (phaseId: string) => {
  if (confirmRemovePhaseId.value !== phaseId) {
    confirmRemovePhaseId.value = phaseId
    return
  }

  committedPhasesList.value = committedPhasesList.value.filter((phase) => phase.id !== phaseId)
  confirmRemovePhaseId.value = null
}

watch(() => props.show, async (show) => {
  if (show && aim.value) {
    confirmRemoveParentId.value = null
    confirmRemovePhaseId.value = null
    aimText.value = aim.value.text
    aimDescription.value = aim.value.description || ''
    aimIntrinsicValue.value = aim.value.intrinsicValue ?? 0
    aimCost.value = aim.value.cost ?? 0
    aimLoopWeight.value = aim.value.loopWeight ?? 0
    aimTags.value = [...(aim.value.tags || [])]
    selectedStatus.value = aim.value.status.state
    statusComment.value = aim.value.status.comment
    reflection.value = aim.value.reflection || ''

    supportedAimsList.value = []
    committedPhasesList.value = []
    originalCommittedPhaseIds.value = [...(aim.value.committedIn || [])]

    if (aim.value.supportedAims && aim.value.supportedAims.length > 0) {
      try {
        const parents = await trpc.aim.list.query({
          projectPath: projectStore.projectPath,
          ids: aim.value.supportedAims
        })
        supportedAimsList.value = parents.map((parent) => ({
          id: parent.id,
          text: parent.text,
          weight: 1
        }))
      } catch (error) {
        console.error('Failed to load supported aims', error)
      }
    }

    if (aim.value.committedIn && aim.value.committedIn.length > 0) {
      try {
        const phases = await Promise.all(
          aim.value.committedIn.map((phaseId) =>
            trpc.phase.get.query({
              projectPath: projectStore.projectPath,
              phaseId
            }).catch(() => null)
          )
        )

        committedPhasesList.value = phases
          .filter((phase): phase is NonNullable<typeof phase> => phase !== null)
          .map((phase) => ({
            id: phase.id,
            name: phase.name
          }))
      } catch (error) {
        console.error('Failed to load committed phases', error)
      }
    }

    await nextTick()
    aimTextInput.value?.focus()
  }
})

watch(() => modalStore.showAimSearch, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen && pendingFocusRestore.value === 'parent' && props.show) {
    await nextTick()
    addParentBtn.value?.focus()
    pendingFocusRestore.value = null
  }
})

watch(() => modalStore.showPhaseSearchPrompt, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen && pendingFocusRestore.value === 'phase' && props.show) {
    await nextTick()
    addPhaseBtn.value?.focus()
    pendingFocusRestore.value = null
  }
})

const handleModalKeydown = (event: KeyboardEvent) => {
  event.stopPropagation()

  if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
    return
  }

  if (event.key !== 'Enter') return

  const target = event.target as HTMLElement | null
  const tagName = target?.tagName

  if (tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) {
    return
  }

  if (tagName === 'BUTTON') {
    return
  }

  event.preventDefault()
  handleSave()
}

const handleInputKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    handleSave()
  }
}

const handleTextareaKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    event.stopPropagation()
    handleSave()
  }
}

const handleStatusCommentNext = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    reflectionInput.value?.focus()
  }
}

const handleLoopWeightNext = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    addParentBtn.value?.focus()
  }
}

const handleTagPrev = () => {
  loopWeightInput.value?.focus()
}

const handleTagNext = () => {
  submitBtn.value?.focus()
}

const handleSave = async () => {
  if (!aim.value || !projectStore.projectPath) return

  await dataStore.updateAim(projectStore.projectPath, aim.value.id, {
    text: aimText.value,
    description: aimDescription.value,
    intrinsicValue: aimIntrinsicValue.value,
    cost: aimCost.value,
    loopWeight: aimLoopWeight.value,
    tags: aimTags.value,
    status: {
      state: selectedStatus.value,
      comment: statusComment.value,
      date: Date.now()
    },
    reflection: reflection.value || undefined,
    supportedAims: supportedAimsList.value.map((entry) => entry.id)
  })

  const currentCommittedPhaseIds = committedPhasesList.value.map((phase) => phase.id)
  const phasesToRemove = originalCommittedPhaseIds.value.filter((phaseId) => !currentCommittedPhaseIds.includes(phaseId))
  const phasesToAdd = currentCommittedPhaseIds.filter((phaseId) => !originalCommittedPhaseIds.value.includes(phaseId))

  for (const phaseId of phasesToRemove) {
    await dataStore.removeAimFromPhase(projectStore.projectPath, aim.value.id, phaseId)
  }

  for (const phaseId of phasesToAdd) {
    await dataStore.commitAimToPhase(projectStore.projectPath, aim.value.id, phaseId)
  }

  emit('close')
}

const handleCancel = () => {
  emit('close')
}
</script>

<template>
  <FormModalShell
    :show="show"
    title="Edit Aim"
    :entity-id="aimId"
    @request-close="handleCancel"
  >
    <div class="modal-content-root" tabindex="-1" @keydown.capture="handleModalKeydown">
      <div class="form-section">
        <label>Title</label>
        <input
          ref="aimTextInput"
          v-model="aimText"
          type="text"
          placeholder="Aim title..."
          class="text-input"
          @keydown="handleInputKeydown"
          @keydown.shift.tab.exact.prevent="submitBtn?.focus()"
        />
      </div>

      <div class="form-section">
        <label>Description</label>
        <textarea
          ref="descriptionInput"
          v-model="aimDescription"
          placeholder="Optional description..."
          class="textarea-input"
          rows="3"
          @keydown="handleTextareaKeydown"
        />
      </div>

      <div class="form-section">
        <label>Status</label>
        <select
          v-model="selectedStatus"
          class="status-select"
          @keydown="handleInputKeydown"
        >
          <option v-for="status in statuses" :key="status.key" :value="status.key">
            {{ status.key }}
          </option>
        </select>
      </div>

      <div class="form-section">
        <label>Status Comment</label>
        <input
          ref="statusCommentInput"
          v-model="statusComment"
          type="text"
          placeholder="Optional comment about status..."
          class="text-input"
          @keydown="handleInputKeydown"
          @keydown.tab.exact="handleStatusCommentNext"
        />
      </div>

      <div class="form-section">
        <label>Reflection</label>
        <textarea
          ref="reflectionInput"
          v-model="reflection"
          placeholder="How did this aim go? What did you learn?"
          class="textarea-input"
          rows="4"
          @keydown="handleTextareaKeydown"
        />
      </div>

      <div class="form-section">
        <label>Supports (Parents)</label>
        <div class="entry-list">
          <div v-for="parent in supportedAimsList" :key="parent.id" class="entry-row">
            <span class="entry-name">{{ parent.text }}</span>
            <label class="entry-meta">
              <span class="entry-meta-label">Weight</span>
              <NumericTextInput v-model="parent.weight" class="entry-inline-input" />
            </label>
            <button
              @click="removeParent(parent.id)"
              class="entry-action"
              :class="{ confirm: confirmRemoveParentId === parent.id }"
              type="button"
            >
              {{ confirmRemoveParentId === parent.id ? 'Confirm' : 'Remove' }}
            </button>
          </div>
          <button
            ref="addParentBtn"
            @click="openParentSearch"
            class="entry-placeholder"
            type="button"
            title="Add supported aim"
          >
            add supported aim
          </button>
        </div>
      </div>

      <div class="form-section">
        <label>Committed In</label>
        <div class="entry-list">
          <div v-for="phase in committedPhasesList" :key="phase.id" class="entry-row">
            <span class="entry-name">{{ phase.name }}</span>
            <span class="entry-meta entry-badge">Phase</span>
            <button
              @click="removeCommittedPhase(phase.id)"
              class="entry-action"
              :class="{ confirm: confirmRemovePhaseId === phase.id }"
              type="button"
            >
              {{ confirmRemovePhaseId === phase.id ? 'Confirm' : 'Remove' }}
            </button>
          </div>
          <button
            ref="addPhaseBtn"
            @click="openPhaseSearch"
            class="entry-placeholder"
            type="button"
            title="Commit in phase"
          >
            commit in phase
          </button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Intrinsic Value</label>
          <input
            v-model.number="aimIntrinsicValue"
            type="text"
            placeholder="0"
            class="text-input"
            @keydown="handleInputKeydown"
          />
        </div>

        <div class="form-group">
          <label>Cost</label>
          <input
            v-model.number="aimCost"
            type="text"
            placeholder="0"
            class="text-input"
            @keydown="handleInputKeydown"
          />
        </div>

        <div class="form-group">
          <label>Loop Weight</label>
          <input
            ref="loopWeightInput"
            v-model.number="aimLoopWeight"
            type="text"
            placeholder="0"
            class="text-input"
            @keydown="handleInputKeydown"
            @keydown.tab.exact="handleLoopWeightNext"
          />
        </div>
      </div>

      <div class="form-section">
        <TagInput
          v-model="aimTags"
          label="Tags"
          @next-field="handleTagNext"
          @prev-field="handleTagPrev"
        />
      </div>
    </div>

    <template #footer>
      <button @click="handleCancel" class="btn-cancel">Cancel</button>
      <button
        ref="submitBtn"
        @click="handleSave"
        class="btn-save"
        @keydown.tab.exact.prevent="aimTextInput?.focus()"
      >
        Save
      </button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.form-section {
  margin-bottom: 0.75rem;
}

label {
  display: block;
  margin-bottom: 0.375rem;
  color: #ccc;
  font-size: 0.9rem;
  font-weight: 700;
}

.status-select,
.text-input,
.textarea-input {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
  font-size: 0.9rem;
}

.status-select:focus,
.text-input:focus,
.textarea-input:focus {
  outline: none;
  border-color: #007acc;
}

.textarea-input {
  font-family: inherit;
  resize: vertical;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.65rem;
}

.entry-name {
  min-width: 0;
  display: block;
  padding: 0.45rem 0.6rem;
  background: #252525;
  border: 1px solid #444;
  border-radius: 0.1875rem;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0;
  color: #bbb;
  white-space: nowrap;
}

.entry-meta-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
}

.entry-inline-input {
  width: 4.5rem;
  padding: 0.3rem 0.4rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
  font-size: 0.85rem;
}

.entry-badge {
  justify-self: start;
  padding: 0.2rem 0.45rem;
  background: #252525;
  border: 1px solid #444;
  border-radius: 999px;
  font-size: 0.78rem;
  color: #bbb;
}

.entry-action,
.entry-placeholder {
  appearance: none;
  display: block;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  font-size: 0.85rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.entry-action {
  padding: 0.4rem 0.65rem;
  background: #444;
  color: #e0e0e0;
}

.entry-action:hover {
  background: #555;
}

.entry-action.confirm {
  background: #6a3a3a;
  border-color: #8a4a4a;
  color: #fff;
}

.entry-action.confirm:hover {
  background: #7a4545;
}

.entry-placeholder {
  width: 100%;
  padding: 0.55rem 0.7rem;
  background: transparent;
  color: #aaa;
  text-align: left;
}

.entry-placeholder:hover,
.entry-placeholder:focus {
  background: #333;
  border-color: #666;
  color: #fff;
  outline: none;
}

.modal-actions {
  display: flex;
  gap: 0.375rem;
  justify-content: flex-end;
}

.btn-cancel,
.btn-save {
  appearance: none;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.1875rem;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
}

.btn-cancel {
  background: #444;
  color: #e0e0e0;
}

.btn-cancel:hover {
  background: #555;
}

.btn-save {
  background: #007acc;
  color: white;
}

.btn-save:hover {
  background: #005a99;
}

.form-row {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.form-group {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.form-group label {
  margin-bottom: 0.375rem;
}
</style>
