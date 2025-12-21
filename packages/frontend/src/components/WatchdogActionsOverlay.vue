<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useWatchdogStore } from '../stores/watchdog'

const store = useWatchdogStore()
const selectedIndex = ref(0)

const actions = [
  {
    id: 'toggle',
    label: () => store.isEnabled ? 'Disable Watchdog' : 'Enable Watchdog',
    action: () => store.toggle(),
    icon: '⚡'
  },
  {
    id: 'clear',
    label: () => 'Clear Main Agent Context',
    action: () => store.sendWorkerInput('/clear\r\n'),
    icon: '🧹'
  },
  {
    id: 'relaunch',
    label: () => 'Relaunch Watchdog Process',
    action: () => store.relaunch(),
    icon: '🔄'
  },
  {
    id: 'cancel',
    label: () => 'Cancel',
    action: () => { store.showActionsOverlay = false },
    icon: '❌'
  }
]

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'j' || e.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % actions.length
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value - 1 + actions.length) % actions.length
  } else if (e.key === 'Enter') {
    const action = actions[selectedIndex.value]
    action.action()
    if (action.id !== 'cancel') store.showActionsOverlay = false
  } else if (e.key === 'Escape') {
    store.showActionsOverlay = false
  }
  // Prevent propagation to terminals
  e.stopPropagation()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true) // Bubble down
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <div class="actions-overlay" @click.self="store.showActionsOverlay = false">
    <div class="actions-modal">
      <div class="modal-header">Watchdog Actions</div>
      <div class="actions-list">
        <div 
          v-for="(action, index) in actions" 
          :key="action.id"
          class="action-item"
          :class="{ selected: index === selectedIndex }"
          @click="action.action(); if (action.id !== 'cancel') store.showActionsOverlay = false"
          @mouseenter="selectedIndex = index"
        >
          <span class="icon">{{ action.icon }}</span>
          <span class="label">{{ action.label() }}</span>
        </div>
      </div>
      <div class="modal-footer">
        Use <kbd>J</kbd>/<kbd>K</kbd> to navigate, <kbd>Enter</kbd> to select
      </div>
    </div>
  </div>
</template>

<style scoped>
.actions-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.actions-modal {
  background: #252526;
  border: 1px solid #444;
  border-radius: 8px;
  width: 300px;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
}

.modal-header {
  padding: 0.75rem 1rem;
  background: #333;
  font-weight: bold;
  font-size: 0.9rem;
  border-bottom: 1px solid #444;
}

.actions-list {
  padding: 0.5rem 0;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background 0.1s;

  &.selected {
    background: #094771;
    color: white;
  }

  .icon {
    font-size: 1.1rem;
    width: 1.5rem;
    text-align: center;
  }

  .label {
    font-size: 0.9rem;
  }
}

.modal-footer {
  padding: 0.5rem 1rem;
  font-size: 0.75rem;
  color: #888;
  border-top: 1px solid #333;
  background: #1e1e1e;
  text-align: center;
}

kbd {
  background: #444;
  color: #eee;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-family: monospace;
}
</style>
