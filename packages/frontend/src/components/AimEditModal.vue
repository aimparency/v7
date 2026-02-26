<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore, type Aim } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import type { AimState } from 'shared'

const props = defineProps<{
  show: boolean
  aimId: string | null
}>()

const emit = defineEmits<{
  'close': []
}>()

const dataStore = useDataStore()
const projectStore = useProjectStore()

const aim = computed(() => {
  if (!props.aimId) return null
  return dataStore.aims[props.aimId] || null
})

const statuses = computed(() => dataStore.getStatuses)

const getCurrentState = computed(() => {
  if (!aim.value) return null
  const state = statuses.value.find((s: AimState) => s.key === aim.value!.status.state)
  return state || null
})

const isOngoing = computed(() => getCurrentState.value?.ongoing ?? true)

// Form state
const aimText = ref('')
const selectedStatus = ref('')
const statusComment = ref('')
const reflection = ref('')

// Track if transitioning to halted
const wasOngoing = ref(true)
const isTransitioningToHalted = computed(() => {
  const newState = statuses.value.find((s: AimState) => s.key === selectedStatus.value)
  return wasOngoing.value && newState && !newState.ongoing
})

watch(() => props.show, (show) => {
  if (show && aim.value) {
    aimText.value = aim.value.text
    selectedStatus.value = aim.value.status.state
    statusComment.value = aim.value.status.comment
    reflection.value = aim.value.reflection || ''
    wasOngoing.value = getCurrentState.value?.ongoing ?? true
  }
})

const handleSave = async () => {
  if (!aim.value || !projectStore.projectPath) return

  await dataStore.updateAim(projectStore.projectPath, aim.value.id, {
    text: aimText.value,
    status: {
      state: selectedStatus.value,
      comment: statusComment.value,
      date: Date.now()
    },
    reflection: reflection.value || undefined
  })

  emit('close')
}

const handleCancel = () => {
  emit('close')
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="handleCancel">
    <div class="modal-content">
      <h2>Edit Aim</h2>

      <div class="form-section">
        <label>Title</label>
        <input
          v-model="aimText"
          type="text"
          placeholder="Aim title..."
          class="text-input"
        />
      </div>

      <div class="form-section">
        <label>Status</label>
        <select v-model="selectedStatus" class="status-select">
          <option v-for="status in statuses" :key="status.key" :value="status.key">
            {{ status.key }}
          </option>
        </select>
      </div>

      <div class="form-section">
        <label>Status Comment</label>
        <input
          v-model="statusComment"
          type="text"
          placeholder="Optional comment about status..."
          class="text-input"
        />
      </div>

      <div class="form-section" :class="{ 'highlight': isTransitioningToHalted }">
        <label>
          Reflection
          <span v-if="isTransitioningToHalted" class="recommendation">(recommended when halting work)</span>
        </label>
        <textarea
          v-model="reflection"
          placeholder="How did this aim go? What did you learn?"
          class="textarea-input"
          rows="4"
        />
      </div>

      <div v-if="isTransitioningToHalted && aim && aim.supportingConnections && aim.supportingConnections.length > 0" class="info-box">
        <strong>Tip:</strong> Consider also reflecting on which sub-aims helped most (you can edit connections in the graph view)
      </div>

      <div class="modal-actions">
        <button @click="handleCancel" class="btn-cancel">Cancel</button>
        <button @click="handleSave" class="btn-save">Save</button>
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
}

h2 {
  margin: 0 0 1rem 0;
  color: #e0e0e0;
  font-size: 1.2rem;
}

.form-section {
  margin-bottom: 1rem;
}

.form-section.highlight {
  padding: 1rem;
  background: rgba(138, 43, 226, 0.1);
  border: 1px solid rgba(138, 43, 226, 0.3);
  border-radius: 4px;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  color: #ccc;
  font-size: 0.9rem;
  font-weight: 500;
}

.recommendation {
  color: #b19cd9;
  font-weight: normal;
  font-size: 0.85rem;
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

.info-box {
  background: rgba(100, 180, 255, 0.1);
  border: 1px solid rgba(100, 180, 255, 0.3);
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #aaa;
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
</style>
