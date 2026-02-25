<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useWatchdogStore } from '../stores/watchdog'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useUIProjectStore } from '../stores/ui/project-store'

const store = useWatchdogStore()
const modalStore = useUIModalStore()
const projectStore = useUIProjectStore()
const selectedIndex = ref(0)
const previouslyFocusedElement = ref<HTMLElement | null>(null)

const actions = [
  {
    id: 'connect',
    key: 's',
    label: () => 'Start/Connect Session',
    action: () => store.connect(),
    icon: '🔌'
  },
  {
    id: 'stop',
    key: 'p',
    label: () => 'Stop Session',
    action: () => store.stop(),
    icon: '⏹️'
  },
  {
    id: 'disconnect',
    key: 'd',
    label: () => 'Disconnect',
    action: () => store.disconnect(),
    icon: '🔗'
  },
  {
    id: 'toggle',
    key: 'm',
    label: () => 'Toggle Animator',
    action: () => store.toggle(),
    icon: '⚡'
  },
  {
    id: 'search',
    key: 'a',
    label: () => 'Search & Insert Aim',
    action: () => {
      modalStore.openAimSearch('pick', (aim) => {
        const textToInsert = `[${aim.id}] ${aim.text}`
        store.sendWorkerInput(textToInsert)
        store.triggerWorkerFocus()
      })
    },
    icon: '🔍'
  },
  {
    id: 'fullscreen',
    key: 'f',
    label: () => projectStore.watchdogMaximized ? 'Exit Fullscreen' : 'Maximize Panel',
    action: () => { projectStore.watchdogMaximized = !projectStore.watchdogMaximized },
    icon: '⛶'
  },
  {
    id: 'hide',
    key: 'w',
    label: () => 'Hide Animator Panel',
    action: () => { projectStore.showWatchdog = false },
    icon: '👁️'
  },
  {
    id: 'clear',
    key: 'c',
    label: () => 'Clear Main Agent Context',
    action: () => store.sendWorkerInput('/clear\r\n'),
    icon: '🧹'
  },
  {
    id: 'relaunch',
    key: 'r',
    label: () => 'Relaunch Animator Process',
    action: () => store.relaunch(),
    icon: '🔄'
  },
  {
    id: 'cancel',
    key: 'Escape',
    label: () => 'Cancel',
    action: () => { store.showActionsOverlay = false },
    icon: '❌'
  }
]

const handleKeydown = (e: KeyboardEvent) => {
  // BLOCK ALL input from reaching xterm
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'j' || e.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % actions.length
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value - 1 + actions.length) % actions.length
  } else if (e.key === 'Enter') {
    executeAction(actions[selectedIndex.value])
  } else if (e.key === 'Escape') {
    store.showActionsOverlay = false
  } else {
    // Check for direct key matches
    const key = e.key.toLowerCase()
    const match = actions.find(a => a.key === key)
    if (match) {
      executeAction(match)
    }
  }
}

const executeAction = (action: any) => {
  action.action()
  if (action.id !== 'cancel') store.showActionsOverlay = false
}

const blockEvent = (e: Event) => {
  e.preventDefault()
  e.stopPropagation()
}

onMounted(() => {
  // Ensure terminals lose focus, but remember what was focused
  if (document.activeElement instanceof HTMLElement) {
    previouslyFocusedElement.value = document.activeElement
    document.activeElement.blur()
  }
  
  // Register handlers in capture phase to intercept before terminals
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('keypress', blockEvent, true)
  window.addEventListener('keyup', blockEvent, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('keypress', blockEvent, true)
  window.removeEventListener('keyup', blockEvent, true)

  // Restore focus if it hasn't been moved elsewhere by other logic
  if (previouslyFocusedElement.value && document.body.contains(previouslyFocusedElement.value)) {
    previouslyFocusedElement.value.focus()
  }
})
</script>

<template>
  <div class="actions-overlay" @click.self="store.showActionsOverlay = false">
    <div class="actions-modal">
      <div class="modal-header">Animator Actions</div>
      <div class="actions-list">
        <div 
          v-for="(action, index) in actions" 
          :key="action.id"
          class="action-item"
          :class="{ selected: index === selectedIndex }"
          @click="executeAction(action)"
          @mouseenter="selectedIndex = index"
        >
          <span class="icon">{{ action.icon }}</span>
          <div class="action-content">
            <span class="label">{{ action.label() }}</span>
            <span v-if="action.key && action.key !== 'Escape'" class="key-hint">{{ action.key.toUpperCase() }}</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <kbd>J</kbd>/<kbd>K</kbd> navigate, <kbd>Enter</kbd> select, or press key
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
  width: 320px;
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
    
    .key-hint {
      color: #aaa;
      border-color: #666;
    }
  }

  .icon {
    font-size: 1.1rem;
    width: 1.5rem;
    text-align: center;
  }

  .action-content {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    font-size: 0.9rem;
  }

  .key-hint {
    font-size: 0.7rem;
    padding: 0.1rem 0.3rem;
    border: 1px solid #444;
    border-radius: 3px;
    color: #666;
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
