<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUIStore } from '../stores/ui'
import { trpc } from '../trpc'

const uiStore = useUIStore()
const name = ref('')
const color = ref('#007acc')
const loading = ref(false)

watch(() => uiStore.showSettingsModal, async (val) => {
  if (val) {
    loading.value = true
    try {
      const meta = await trpc.project.getMeta.query({ projectPath: uiStore.projectPath })
      if (meta) {
          name.value = meta.name
          color.value = meta.color
      }
    } catch (e) {
      console.error(e)
    } finally {
      loading.value = false
    }
  }
})

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') uiStore.closeSettingsModal()
  if (e.key === 'Enter') save()
}

const save = async () => {
    try {
        await trpc.project.updateMeta.mutate({
            projectPath: uiStore.projectPath,
            meta: { name: name.value, color: color.value }
        })
        uiStore.closeSettingsModal()
    } catch (e) {
        console.error(e)
    }
}
</script>

<template>
  <div v-if="uiStore.showSettingsModal" class="modal-overlay">
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
                @keydown="handleKeydown"
            />
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button @click="uiStore.closeSettingsModal" class="btn-secondary">
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
  
  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid #555;
    h3 { margin: 0; }
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
