<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useUIStore } from './stores/ui'
import { useDataStore } from './stores/data'
import { useKeyboardStore } from './stores/keyboard'

const uiStore = useUIStore()
const dataStore = useDataStore()
const keyboardStore = useKeyboardStore()

// Initialize UI state from store
if (uiStore.projectPath) {
  uiStore.setMode('column-navigation')
} else {
  uiStore.setMode('project-selection')
}

const selectProject = async () => {
  const path = prompt('Enter project base folder path:')
  if (path) {
    uiStore.setProjectPath(path)
    uiStore.setConnectionStatus('connecting')
    await dataStore.loadPhases(path)
    uiStore.setConnectionStatus('connected')
  }
}

const closeProject = () => {
  uiStore.setProjectPath('')
}

// Keyboard navigation using store
const handleKeydown = async (event: KeyboardEvent) => {
  if (uiStore.isInProjectSelection) return
  
  // Prevent default behavior for navigation keys
  if (['h', 'j', 'k', 'l', 'i', 'o', 'O', 'Escape'].includes(event.key)) {
    event.preventDefault()
  }
  
  await keyboardStore.handleKeydown(event)
}


onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  if (uiStore.projectPath) {
    uiStore.setConnectionStatus('connecting')
    await dataStore.loadPhases(uiStore.projectPath)
    uiStore.setConnectionStatus('connected')
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header v-if="!uiStore.isInProjectSelection" class="header">
      <div class="status">
        <span class="connection-status" :class="uiStore.connectionStatus">
          {{ uiStore.connectionStatus === 'connected' ? 'Connected to' : uiStore.connectionStatus }}
          {{ uiStore.connectionStatus === 'connected' ? 'aimparency server' : '' }}
        </span>
        <span class="project-path">{{ uiStore.projectPath }}</span>
        <button @click="closeProject" class="close-project">Close Project</button>
      </div>
    </header>

    <!-- Project Selection -->
    <div v-if="uiStore.isInProjectSelection" class="project-selection">
      <h1>Aimparency</h1>
      <p>Select a project base folder to get started</p>
      <button @click="selectProject" class="select-project">Select Project Folder</button>
    </div>

    <!-- Main Interface -->
    <main v-else class="main">
      <div class="phase-columns">
        <!-- Left Column -->
        <div 
          class="column left-column" 
          :class="{ 
            focused: uiStore.focusedColumn === 'left', 
            'in-edit-mode': uiStore.isInPhaseEdit 
          }"
        >
          <!-- Phase Navigation Mode -->
          <div v-if="uiStore.isInColumnNavigation" class="phase-list">
            <div 
              v-for="(phase, index) in dataStore.leftColumnPhases" 
              :key="phase.id"
              class="phase-item"
              :class="{ selected: index === uiStore.selectedPhaseIndex }"
            >
              <div class="phase-name">{{ phase.name }}</div>
              <div class="phase-info">{{ phase.commitments?.length || 0 }} aims</div>
            </div>
          </div>
          
          <!-- Phase Edit Mode - Show aims -->
          <div v-else-if="uiStore.isInPhaseEdit" class="aims-list">
            <!-- TODO: Aim components will go here -->
            <div class="empty-state">Phase aims will be displayed here</div>
          </div>
        </div>

        <!-- Right Column -->
        <div 
          class="column right-column" 
          :class="{ focused: uiStore.focusedColumn === 'right' }"
        >
          <div class="phase-list">
            <div 
              v-for="phase in dataStore.rightColumnPhases" 
              :key="phase.id"
              class="phase-item"
            >
              <div class="phase-name">{{ phase.name }}</div>
              <div class="phase-info">{{ phase.commitments?.length || 0 }} aims</div>
            </div>
          </div>
          <div v-if="dataStore.rightColumnPhases.length === 0" class="empty-state">
            No child phases
          </div>
        </div>
      </div>

    </main>

    <!-- Help Text -->
    <footer v-if="!uiStore.isInProjectSelection" class="help">
      <div class="help-keys">
        <span v-for="help in keyboardStore.keyHelp" :key="help.description">
          <kbd v-for="key in help.keys" :key="key">{{ key }}</kbd>
          {{ help.description }}
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #e0e0e0;
  font-family: 'Monaco', 'Menlo', monospace;
}

.header {
  background: #2d2d2d;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #444;
}

.status {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.connection-status {
  font-weight: bold;
}

.connection-status.connecting {
  color: #ffa500;
}

.connection-status.connected {
  color: #00ff00;
}

.connection-status.no-connection {
  color: #ff0000;
}

.project-path {
  font-family: monospace;
  color: #888;
}

.close-project {
  background: none;
  border: 1px solid #666;
  color: #e0e0e0;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  border-radius: 3px;
}

.close-project:hover {
  background: #444;
}

.project-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
}

.select-project {
  background: #007acc;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 5px;
  cursor: pointer;
  font-size: 1.1rem;
}

.select-project:hover {
  background: #005a99;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.phase-columns {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.column {
  flex: 1;
  border-right: 1px solid #444;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column:last-child {
  border-right: none;
}

.column.focused {
  background: #252525;
}

.column.in-edit-mode {
  opacity: 0.7;
}

.column-header {
  background: #333;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #555;
  font-weight: bold;
}

.phase-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.phase-item {
  padding: 0.5rem;
  margin-bottom: 0.25rem;
  border-radius: 3px;
  cursor: pointer;
}

.phase-item.selected {
  background: #007acc;
}

.phase-item:hover:not(.selected) {
  background: #333;
}

.phase-name {
  font-weight: bold;
  margin-bottom: 0.25rem;
}

.phase-info {
  font-size: 0.9rem;
  color: #888;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}


.help {
  background: #2d2d2d;
  padding: 0.5rem 1rem;
  border-top: 1px solid #444;
}

.help-keys {
  display: flex;
  gap: 2rem;
  font-size: 0.9rem;
  color: #888;
}

.help-keys span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

kbd {
  background: #444;
  color: #fff;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-family: monospace;
}

/* Modal styles */
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
  width: 400px;
  max-width: 90vw;
  
  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid #555;
    
    h3 {
      margin: 0;
    }
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
      
      input {
        width: 100%;
        padding: 0.5rem;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 3px;
        color: #e0e0e0;
        font-family: monospace;
        
        &:focus {
          outline: none;
          border-color: #007acc;
        }
        
        &::placeholder {
          color: #666;
        }
      }
    }
    
    .form-row {
      display: flex;
      gap: 1rem;
      
      .form-group {
        flex: 1;
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
      font-family: monospace;
      
      &.btn-primary {
        background: #007acc;
        color: white;
        
        &:hover:not(:disabled) {
          background: #005a99;
        }
        
        &:disabled {
          background: #444;
          color: #666;
          cursor: not-allowed;
        }
      }
      
      &.btn-secondary {
        background: #444;
        color: #e0e0e0;
        
        &:hover {
          background: #555;
        }
      }
    }
  }
}
</style>