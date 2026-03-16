<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useDataStore, type Aim } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { trpc } from '../trpc'
import TagInput from './TagInput.vue'

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
const submitBtn = ref<HTMLButtonElement>()

const openParentSearch = () => {
  modalStore.openAimSearch('pick', (aim: Aim) => {
    if (!supportedAimsList.value.some(a => a.id === aim.id)) {
      supportedAimsList.value.push({ id: aim.id, text: aim.text, weight: 1 })
    }
  })
}

const removeParent = (index: number) => {
  supportedAimsList.value.splice(index, 1)
}

watch(() => props.show, async (show) => {
  if (show && aim.value) {
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

    // Focus title input after modal opens
    await nextTick()
    aimTextInput.value?.focus()
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
        <div class="label-row">
          <label>Supports (Parents)</label>
          <button ref="addParentBtn" @click="openParentSearch" class="btn-add" type="button" title="Add Parent">+</button>
        </div>
        <div v-for="(parent, index) in supportedAimsList" :key="parent.id" class="aim-row">
          <span class="aim-text">{{ parent.text }}</span>
          <div class="weight-input">
            <span class="weight-label">Weight:</span>
            <input type="text" v-model.number="parent.weight" class="weight-field" />
          </div>
          <button @click="removeParent(index)" class="btn-remove" type="button" title="Remove">×</button>
        </div>
        <div v-if="supportedAimsList.length === 0" class="empty-list">No parent aims</div>
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
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 1.5rem;
  min-width: 500px;
  max-width: 600px;
  max-height: 85vh;
  overflow-y: auto;
}

h2 {
  margin: 0 0 1rem 0;
  color: #e0e0e0;
  font-size: 1.2rem;
}

.form-section {
  margin-bottom: 1rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  color: #ccc;
  font-size: 0.9rem;
  font-weight: 500;
}

.status-select,
.text-input {
  width: 100%;
  padding: 0.5rem;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
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
  width: 100%;
  padding: 0.5rem;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}

.btn-cancel,
.btn-save {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
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
  background: #005a9e;
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

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.btn-add {
  padding: 0.2rem 0.6rem;
  background: #007acc;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-add:hover {
  background: #005a9e;
}

.aim-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #444;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.aim-text {
  flex: 1;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weight-input {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.weight-label {
  font-size: 0.8rem;
  color: #999;
}

.weight-field {
  width: 4rem;
  padding: 0.25rem;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 0.85rem;
}

.btn-remove {
  padding: 0.2rem 0.5rem;
  background: #cc0000;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1.2rem;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.2s;
  line-height: 1;
}

.btn-remove:hover {
  background: #ff0000;
}

.empty-list {
  color: #666;
  font-style: italic;
  font-size: 0.9rem;
  text-align: center;
  padding: 0.5rem;
}
</style>
