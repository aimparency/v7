<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'

const emit = defineEmits(['close'])

const dataStore = useDataStore()
const projectStore = useProjectStore()

const isFixing = ref(false)
const fixesApplied = ref<string[]>([])

const hasAutoFixableErrors = computed(() => {
    return dataStore.consistencyErrors.some(e => !e.startsWith('Cycle detected'))
})

const handleFix = async () => {
  isFixing.value = true
  try {
    const fixes = await dataStore.fixConsistency(projectStore.projectPath)
    if (fixes && fixes.length > 0) {
        fixesApplied.value = fixes
    }
  } catch (e) {
    alert('Failed to fix inconsistencies: ' + e)
  } finally {
    isFixing.value = false
  }
}

const getActionForError = (error: string) => {
    if (error.includes('non-existent phase')) return 'Remove invalid phase link'
    if (error.includes('does not have it in commitments')) return 'Add to phase commitments'
    if (error.includes('non-existent supporting connection')) return 'Remove invalid child link'
    if (error.includes('non-existent supportedAims')) return 'Remove invalid parent link'
    if (error.includes('does not list')) return 'Sync bidirectional link'
    if (error.includes('Orphaned embedding')) return 'Delete orphaned embedding'
    if (error.includes('Cycle detected')) return 'Manual Fix Required'
    return 'Auto-fix'
}

const close = () => {
    emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h2>Data Inconsistencies</h2>
      
      <div class="scroll-area">
        <!-- Fixes Report -->
        <div v-if="fixesApplied.length > 0" class="section success">
            <h3>✅ Fixed {{ fixesApplied.length }} Issues</h3>
            <ul>
                <li v-for="(fix, i) in fixesApplied" :key="i">{{ fix }}</li>
            </ul>
        </div>

        <!-- Errors -->
        <div v-if="dataStore.consistencyErrors.length > 0" class="section">
            <h3 v-if="fixesApplied.length > 0" class="warning-header">⚠️ Remaining Issues (Manual Fix Required)</h3>
            <div class="error-list">
                <div v-for="(error, i) in dataStore.consistencyErrors" :key="i" class="error-item">
                    <span class="icon">⚠️</span>
                    <div class="text-col">
                        <span class="text">{{ error }}</span>
                        <span class="action-hint" v-if="getActionForError(error) !== 'Manual Fix Required'">
                            🛠️ Will: {{ getActionForError(error) }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="dataStore.consistencyErrors.length === 0 && fixesApplied.length === 0" class="no-errors">
            No inconsistencies found.
        </div>
      </div>

      <div class="actions">
        <button class="secondary-btn" @click="close">{{ dataStore.consistencyErrors.length === 0 ? 'Close' : 'Cancel' }}</button>
        <button 
            v-if="hasAutoFixableErrors"
            class="primary-btn danger" 
            @click="handleFix" 
            :disabled="isFixing"
        >
            {{ isFixing ? 'Fixing...' : 'Fix Auto-fixable Issues' }}
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
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: #252525;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 700px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border: 1px solid #444;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.scroll-area {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 1.5rem;
    padding-right: 0.5rem;
}

h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #e0e0e0;
}

h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
    color: #4CAF50;
    font-size: 1rem;
}

.warning-header {
    color: #ffaa00;
    margin-top: 1.5rem;
}

.section {
    margin-bottom: 1rem;
}

.section.success ul {
    background: #1a1a1a;
    padding: 1rem 2rem;
    border-radius: 4px;
    color: #ccc;
    font-size: 0.9rem;
    margin: 0;
}

.error-list {
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

.text-col {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.action-hint {
    color: #4CAF50;
    font-size: 0.8rem;
    font-style: italic;
}

.no-errors {
    color: #888;
    text-align: center;
    padding: 1rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  border-top: 1px solid #333;
  padding-top: 1rem;
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
