<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { trpc } from '../trpc'
import TagInput from './TagInput.vue'
import NumericTextInput from './NumericTextInput.vue'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'

const props = defineProps<{
  show: boolean
  aimId: string | null
}>()

const emit = defineEmits<{
  'close': []
}>()

const dataStore = useDataStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()

const aim = computed(() => {
  if (!props.aimId) return null
  return dataStore.aims[props.aimId] || null
})

const statuses = computed(() => dataStore.getStatuses)

// Form state
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

// Template refs
const modalOverlay = ref<HTMLDivElement>()
const aimTextInput = ref<HTMLInputElement>()
const descriptionInput = ref<HTMLTextAreaElement>()
const statusSelect = ref<HTMLSelectElement>()
const statusCommentInput = ref<HTMLInputElement>()
const reflectionInput = ref<HTMLTextAreaElement>()
const intrinsicValueInput = ref<HTMLInputElement>()
const costInput = ref<HTMLInputElement>()
const loopWeightInput = ref<HTMLInputElement>()
const addParentBtn = ref<HTMLButtonElement>()
const addPhaseBtn = ref<HTMLButtonElement>()
const submitBtn = ref<HTMLButtonElement>()

// Track which button opened a search modal so we can restore focus
const pendingFocusRestore = ref<'parent' | 'phase' | null>(null)

const openParentSearch = () => {
  pendingFocusRestore.value = 'parent'
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

const openPhaseSearch = () => {
  pendingFocusRestore.value = 'phase'
  modalStore.openPhaseSearchPrompt((payload: PhaseSearchSelection) => {
    if (payload.type !== 'phase') return
    const phase = payload.data
    if (!committedPhasesList.value.some(entry => entry.id === phase.id)) {
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

  supportedAimsList.value = supportedAimsList.value.filter(parent => parent.id !== parentId)
  confirmRemoveParentId.value = null
}

const removeCommittedPhase = (phaseId: string) => {
  if (confirmRemovePhaseId.value !== phaseId) {
    confirmRemovePhaseId.value = phaseId
    return
  }

  committedPhasesList.value = committedPhasesList.value.filter(phase => phase.id !== phaseId)
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

    // Load supported aims (Parents)
    supportedAimsList.value = []
    committedPhasesList.value = []
    originalCommittedPhaseIds.value = [...(aim.value.committedIn || [])]
    if (aim.value.supportedAims && aim.value.supportedAims.length > 0) {
      try {
        const parents = await trpc.aim.list.query({
          projectPath: projectStore.projectPath,
          ids: aim.value.supportedAims
        })
        supportedAimsList.value = parents.map(p => ({
          id: p.id,
          text: p.text,
          weight: 1
        }))
      } catch (e) {
        console.error("Failed to load supported aims", e)
      }
    }

    if (aim.value.committedIn && aim.value.committedIn.length > 0) {
      try {
        const phases = await Promise.all(
          aim.value.committedIn.map(phaseId =>
            trpc.phase.get.query({
              projectPath: projectStore.projectPath,
              phaseId
            }).catch(() => null)
          )
        )

        committedPhasesList.value = phases
          .filter((phase): phase is NonNullable<typeof phase> => phase !== null)
          .map(phase => ({
            id: phase.id,
            name: phase.name
          }))
      } catch (e) {
        console.error('Failed to load committed phases', e)
      }
    }

    // Focus title input after modal opens
    await nextTick()
    aimTextInput.value?.focus()
  }
})

// Watch for search modals closing and restore focus to the button that opened them
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
  // Stop ALL keyboard events from leaking through the modal
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
    supportedAims: supportedAimsList.value.map(a => a.id)
  })

  const currentCommittedPhaseIds = committedPhasesList.value.map(phase => phase.id)
  const phasesToRemove = originalCommittedPhaseIds.value.filter(phaseId => !currentCommittedPhaseIds.includes(phaseId))
  const phasesToAdd = currentCommittedPhaseIds.filter(phaseId => !originalCommittedPhaseIds.value.includes(phaseId))

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
  <div v-if="show" ref="modalOverlay" class="modal-overlay" tabindex="-1" @click.self="handleCancel" @keydown="handleModalKeydown">
    <div class="modal-content">
      <h2>Edit Aim</h2>

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
          ref="statusSelect"
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
            ref="intrinsicValueInput"
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
            ref="costInput"
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

      <div class="modal-actions">
        <button @click="handleCancel" class="btn-cancel">Cancel</button>
        <button
          ref="submitBtn"
          @click="handleSave"
          class="btn-save"
          @keydown.tab.exact.prevent="aimTextInput?.focus()"
        >
          Save
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
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #1f1d1a;
  border: 1px solid #575047;
  border-radius: 10px;
  padding: 1.5rem;
  min-width: 500px;
  max-width: 600px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.35);
}

h2 {
  margin: 0 0 1rem 0;
  color: #f0eadf;
  font-size: 1.2rem;
}

.form-section {
  margin-bottom: 1rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  color: #d4cbbe;
  font-size: 0.9rem;
  font-weight: 500;
}

.status-select,
.text-input {
  width: 100%;
  padding: 0.5rem;
  background: #2b2824;
  border: 1px solid #575047;
  border-radius: 6px;
  color: #f0eadf;
  font-size: 0.9rem;
}

.status-select:focus,
.text-input:focus,
.textarea-input:focus {
  outline: none;
  border-color: #b09a72;
  box-shadow: 0 0 0 1px rgba(176, 154, 114, 0.25);
}

.textarea-input {
  width: 100%;
  padding: 0.5rem;
  background: #2b2824;
  border: 1px solid #575047;
  border-radius: 6px;
  color: #f0eadf;
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}

.entry-name {
  min-width: 0;
  display: block;
  padding: 0.5rem 0.7rem;
  background: #2a2723;
  border: 1px solid #4f4942;
  border-radius: 8px;
  color: #f0eadf;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0;
  color: #c8bcaa;
  white-space: nowrap;
}

.entry-meta-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #a99a84;
}

.entry-inline-input {
  width: 4.5rem;
  padding: 0.35rem 0.45rem;
  background: #24211d;
  border: 1px solid #575047;
  border-radius: 6px;
  color: #f0eadf;
  font-size: 0.85rem;
}

.entry-inline-input:focus {
  outline: none;
  border-color: #b09a72;
  box-shadow: 0 0 0 1px rgba(176, 154, 114, 0.25);
}

.entry-badge {
  justify-self: start;
  padding: 0.28rem 0.55rem;
  background: #2d2a25;
  border: 1px solid #5f574d;
  border-radius: 999px;
  font-size: 0.78rem;
  color: #d8cebf;
}

.entry-action,
.entry-placeholder {
  appearance: none;
  display: block;
  border: 1px solid #5f574d;
  border-radius: 8px;
  font-size: 0.85rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.entry-action {
  padding: 0.45rem 0.75rem;
  background: #2f2b26;
  color: #dfd4c5;
}

.entry-action:hover {
  background: #38332d;
}

.entry-action.confirm {
  background: #5a4738;
  border-color: #87684f;
  color: #fff3e5;
}

.entry-action.confirm:hover {
  background: #675140;
}

.entry-placeholder {
  width: 100%;
  padding: 0.7rem 0.8rem;
  background: transparent;
  color: #c8bcaa;
  text-align: left;
}

.entry-placeholder:hover,
.entry-placeholder:focus {
  background: #2a2723;
  border-color: #776b5d;
  color: #f0eadf;
  outline: none;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}

.btn-cancel,
.btn-save {
  appearance: none;
  padding: 0.5rem 1rem;
  border: 1px solid #5f574d;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.btn-cancel {
  background: #2d2a26;
  color: #e7ddd0;
}

.btn-cancel:hover {
  background: #393530;
}

.btn-save {
  background: #867256;
  border-color: #9a8567;
  color: #fff8ef;
}

.btn-save:hover {
  background: #978265;
}

.form-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.form-group {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.form-group label {
  margin-bottom: 0.5rem;
}
</style>
