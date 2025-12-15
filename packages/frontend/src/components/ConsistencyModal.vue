<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'

const emit = defineEmits(['close'])

const dataStore = useDataStore()
const uiStore = useUIStore()

const isFixing = ref(false)
const fixesApplied = ref<string[]>([])

const handleFix = async () => {
  isFixing.value = true
  try {
    const fixes = await dataStore.fixConsistency(uiStore.projectPath)
    if (fixes) {
        fixesApplied.value = fixes
    }
  } catch (e) {
    alert('Failed to fix inconsistencies: ' + e)
  } finally {
    isFixing.value = false
  }
}

const close = () => {
    emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h2>Data Inconsistencies</h2>
      
      <div v-if="fixesApplied.length > 0" class="success-message">
        <h3>Fixed Successfully!</h3>
        <ul>
            <li v-for="(fix, i) in fixesApplied" :key="i">{{ fix }}</li>
        </ul>
        <div class="actions">
            <button class="primary-btn" @click="close">Close</button>
        </div>
      </div>

      <div v-else>
          <div class="error-list">
            <div v-for="(error, i) in dataStore.consistencyErrors" :key="i" class="error-item">
                <span class="icon">⚠️</span>
                <span class="text">{{ error }}</span>
            </div>
            <div v-if="dataStore.consistencyErrors.length === 0" class="no-errors">
                No inconsistencies found.
            </div>
          </div>

          <div class="actions">
            <button class="secondary-btn" @click="close">Cancel</button>
            <button 
                v-if="dataStore.consistencyErrors.length > 0"
                class="primary-btn danger" 
                @click="handleFix" 
                :disabled="isFixing"
            >
                {{ isFixing ? 'Fixing...' : 'Fix All Issues' }}
            </button>
          </div>
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
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: #252525;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 1px solid #444;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #e0e0e0;
}

h3 {
    margin-top: 0;
    color: #4CAF50;
}

.error-list {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 2rem;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 1rem;
}

.error-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #333;
  color: #ffaa00;
  font-size: 0.9rem;
  line-height: 1.4;
}

.error-item:last-child {
  border-bottom: none;
}

.icon {
  flex-shrink: 0;
}

.no-errors {
    color: #888;
    text-align: center;
    padding: 1rem;
}

.success-message ul {
    background: #1a1a1a;
    padding: 1rem 2rem;
    border-radius: 4px;
    max-height: 300px;
    overflow-y: auto;
    color: #ccc;
    font-size: 0.9rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}

button {
  padding: 0.6rem 1.2rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  border: none;
}

.secondary-btn {
  background: #333;
  color: #ccc;
}

.secondary-btn:hover {
  background: #444;
}

.primary-btn {
  background: #007acc;
  color: white;
}

.primary-btn:hover {
  background: #005a99;
}

.primary-btn.danger {
  background: #d32f2f;
}

.primary-btn.danger:hover {
  background: #b71c1c;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>