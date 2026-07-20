<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useProjectStore } from '../stores/project-store'

type LoopAction =
  | 'create-loop'
  | 'create-instance'
  | 'duplicate-loop'
  | 'start-instance'
  | 'stop-instance'
  | 'restart-instance'

const emit = defineEmits<{ action: [action: LoopAction] }>()
const projectStore = useProjectStore()
const selectedIndex = ref(0)

const actions = [
  { id: 'create-loop', key: 'l', label: () => 'Create loop configuration', run: () => emit('action', 'create-loop') },
  { id: 'create-instance', key: 'n', label: () => 'Create loop instance', run: () => emit('action', 'create-instance') },
  { id: 'duplicate-loop', key: 'd', label: () => 'Duplicate loop configuration', run: () => emit('action', 'duplicate-loop') },
  { id: 'start-instance', key: 's', label: () => 'Start selected instance', run: () => emit('action', 'start-instance') },
  { id: 'stop-instance', key: 'p', label: () => 'Stop selected instance', run: () => emit('action', 'stop-instance') },
  { id: 'restart-instance', key: 'r', label: () => 'Restart selected instance', run: () => emit('action', 'restart-instance') },
  {
    id: 'fullscreen',
    key: 'f',
    label: () => projectStore.loopMaximized ? 'Exit fullscreen' : 'Maximize loop panel',
    run: () => { projectStore.loopMaximized = !projectStore.loopMaximized }
  },
  {
    id: 'hide',
    key: 'a',
    label: () => 'Hide loop panel',
    run: () => { projectStore.showLoop = false }
  }
] as const

const close = () => {
  projectStore.showLoopActionsOverlay = false
}

const execute = (action: typeof actions[number]) => {
  action.run()
  close()
}

const handleKeydown = (event: KeyboardEvent) => {
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'j' || event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % actions.length
    return
  }
  if (event.key === 'k' || event.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value - 1 + actions.length) % actions.length
    return
  }
  if (event.key === 'Enter') {
    execute(actions[selectedIndex.value]!)
    return
  }
  if (event.key === 'Escape') {
    close()
    return
  }

  const action = actions.find((candidate) => candidate.key === event.key.toLowerCase())
  if (action) execute(action)
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))
</script>

<template>
  <div class="actions-overlay" @click.self="close">
    <div class="actions-modal" role="dialog" aria-modal="true" aria-label="Loop actions">
      <header>Loop actions</header>
      <button
        v-for="(action, index) in actions"
        :key="action.id"
        type="button"
        class="action"
        :class="{ selected: selectedIndex === index }"
        @click="execute(action)"
        @mouseenter="selectedIndex = index"
      >
        <span>{{ action.label() }}</span>
        <kbd>{{ action.key.toUpperCase() }}</kbd>
      </button>
      <footer><kbd>J</kbd>/<kbd>K</kbd> navigate, <kbd>Enter</kbd> select</footer>
    </div>
  </div>
</template>

<style scoped>
.actions-overlay {
  position: absolute;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 60%);
}

.actions-modal {
  width: min(22rem, calc(100vw - 2rem));
  overflow: hidden;
  border: 1px solid #4b4b4b;
  border-radius: 0.5rem;
  background: #252526;
  box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 45%);
}

header,
footer {
  padding: 0.7rem 0.9rem;
  color: #d8d8d8;
}

header {
  border-bottom: 1px solid #414141;
  background: #303030;
  font-weight: 600;
}

footer {
  border-top: 1px solid #414141;
  color: #a8a8a8;
  font-size: 0.75rem;
}

.action {
  display: flex;
  width: 100%;
  min-height: 2.25rem;
  align-items: center;
  justify-content: space-between;
  border: 0;
  background: transparent;
  color: #e7e7e7;
  padding: 0.45rem 0.9rem;
  text-align: left;
  cursor: pointer;
}

.action:hover,
.action.selected {
  background: #094771;
}

kbd {
  min-width: 1.4rem;
  border: 1px solid #5a5a5a;
  border-radius: 0.2rem;
  background: #333;
  padding: 0.1rem 0.3rem;
  color: #ddd;
  font: inherit;
  font-size: 0.72rem;
  text-align: center;
}
</style>
