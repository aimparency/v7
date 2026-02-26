<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import { INITIAL_STATES } from 'shared'

const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()
const name = ref('')
const color = ref('#007acc')
const statuses = ref<Array<{ key: string, color: string }>>([])
const loading = ref(false)
const isUpdatingInstructions = ref(false)
const updateResults = ref<string[]>([])

const blockLeakage = (e: KeyboardEvent) => {
  // If typing in any input, let it through but stop it from reaching others
  if (e.target instanceof HTMLInputElement) {
    e.stopPropagation()
    return
  }
  e.stopPropagation()
}

onMounted(async () => {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  window.addEventListener('keydown', blockLeakage, true)

  // Load data
  loading.value = true
  try {
    const meta = dataStore.meta || await trpc.project.getMeta.query({ projectPath: projectStore.projectPath })
    if (meta) {
        name.value = meta.name
        color.value = meta.color
        statuses.value = JSON.parse(JSON.stringify(meta.statuses || INITIAL_STATES))
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockLeakage, true)
})

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') modalStore.closeSettingsModal()
  // Disable enter to save because it conflicts with status editing?
  // Or just allow it if not in an input.
}

const addStatus = () => {
  statuses.value.push({ key: 'new-status', color: '#888888' })
}

const removeStatus = (index: number) => {
  statuses.value.splice(index, 1)
}

const updateInstructions = async () => {
    isUpdatingInstructions.value = true
    updateResults.value = []
    try {
        const res = await trpc.project.injectAgentInstructions.mutate({ projectPath: projectStore.projectPath })
        updateResults.value = res.results
    } catch (e: any) {
        updateResults.value = [`Error: ${e.message}`]
    } finally {
        isUpdatingInstructions.value = false
    }
}

const save = async () => {
    try {
        await dataStore.updateProjectMeta(projectStore.projectPath, { 
          name: name.value, 
          color: color.value,
          statuses: statuses.value 
        })
        await dataStore.loadProject(projectStore.projectPath)
        modalStore.closeSettingsModal()
    } catch (e) {
        console.error(e)
    }
}
</script>

<template>
  <div v-if="modalStore.showSettingsModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3>Project Settings</h3>
      </div>
      
      <div class="modal-body">
        <div class="form-group">
          <label>Project Name</label>
          <input 
            v-model="name" 
            type="text" 
            placeholder="Project Name"
            @keydown="handleKeydown"
          />
        </div>

        <div class="form-group">
          <label>Project Color</label>
          <div class="color-picker-row">
            <input 
                v-model="color" 
                type="color" 
                class="color-input"
            />
            <input 
                v-model="color" 
                type="text" 
                placeholder="#RRGGBB"
                @keydown.enter="save"
            />
          </div>
        </div>

        <div class="form-group">
          <label>Aim Statuses</label>
          <div class="status-list">
            <div v-for="(status, index) in statuses" :key="index" class="status-row">
              <input 
                v-model="status.color" 
                type="color" 
                class="status-color-input"
              />
              <input 
                v-model="status.key" 
                type="text" 
                placeholder="key"
                class="status-key-input"
                @input="status.key = status.key.toLowerCase().replace(/\s+/g, '-')"
              />
              <button @click="removeStatus(index)" class="delete-btn" title="Remove Status">×</button>
            </div>
          </div>
          <button @click="addStatus" class="add-btn">+ Add Status</button>
        </div>

        <div class="form-group">
          <label>Agent Integration</label>
          <p class="hint-text">Injects Aimparency MCP instructions into .gemini/GEMINI.md, CLAUDE.md, etc.</p>
          <button @click="updateInstructions" class="action-btn" :disabled="isUpdatingInstructions">
            {{ isUpdatingInstructions ? 'Updating...' : 'Update Agent Instructions' }}
          </button>
          <div v-if="updateResults.length > 0" class="update-results">
            <div v-for="(res, i) in updateResults" :key="i" class="result-line">{{ res }}</div>
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button @click="modalStore.closeSettingsModal" class="btn-secondary">
          Cancel
        </button>
        <button @click="save" class="btn-primary">
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
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 5px;
  width: 25rem;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;

  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid #555;
    flex-shrink: 0;
    h3 { margin: 0; }
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
      
      input[type="text"] {
        width: 100%;
        padding: 0.5rem;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 3px;
        color: #e0e0e0;
        
        &:focus {
          outline: none;
          border-color: #007acc;
        }
      }
      
      .color-picker-row {
        display: flex;
        gap: 0.5rem;
        
        .color-input {
            width: 3rem;
            height: 2.5rem;
            padding: 0;
            border: none;
            cursor: pointer;
            background: none;
        }
      }
    }

    .status-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      max-height: 12rem;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .status-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;

      .status-color-input {
        width: 2.5rem;
        height: 2rem;
        padding: 0;
        border: none;
        cursor: pointer;
        background: none;
        flex-shrink: 0;
      }

      .status-key-input {
        flex: 1;
      }

      .delete-btn {
        background: transparent;
        border: none;
        color: #ff6666;
        font-size: 1.5rem;
        cursor: pointer;
        line-height: 1;
        padding: 0 0.25rem;
        
        &:hover {
          color: #ff4444;
        }
      }
    }

    .add-btn {
      width: 100%;
      padding: 0.4rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px dashed #555;
      color: #888;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.85rem;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ccc;
        border-color: #777;
      }
    }

    .hint-text {
      font-size: 0.8rem;
      color: #888;
      margin-bottom: 0.5rem;
      margin-top: -0.25rem;
    }

    .action-btn {
      width: 100%;
      padding: 0.5rem;
      background: #333;
      border: 1px solid #555;
      color: #e0e0e0;
      border-radius: 3px;
      cursor: pointer;
      &:hover { background: #444; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .update-results {
      margin-top: 0.5rem;
      font-size: 0.8rem;
      color: #88ff88;
      background: rgba(0,0,0,0.2);
      padding: 0.5rem;
      border-radius: 3px;
    }
    
    .result-line { margin-bottom: 0.2rem; }
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
        &:hover { background: #005a99; }
      }
      
      &.btn-secondary {
        background: #444;
        color: #e0e0e0;
        &:hover { background: #555; }
      }
    }
  }
}
</style>
