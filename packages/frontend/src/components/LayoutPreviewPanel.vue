<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { LayoutChange } from '../utils/autolayout'

// Preview of an autolayout: the graph already shows the first `count` changes
// (largest shifts first) and the placed unconnected ideas; nothing is saved
// until Apply. Positions only: no connection changes, so no file changes.
const props = defineProps<{ changes: LayoutChange[]; placed: number }>()
const count = defineModel<number>('count', { required: true })
const positionsOnly = defineModel<boolean>('positionsOnly', { required: true })
const emit = defineEmits<{ apply: []; cancel: [] }>()

const files = computed(() => new Set(props.changes.slice(0, count.value).map(change => change.parentId)).size)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('cancel')
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div id="layout-preview">
    <label v-if="changes.length > 0" :class="{ disabled: positionsOnly }">
      <span>Connections changed: {{ positionsOnly ? 0 : count }} of {{ changes.length }} ({{ positionsOnly ? 0 : files }} idea files)</span>
      <input v-model.number="count" type="range" min="1" :max="changes.length" step="1" :disabled="positionsOnly" />
    </label>
    <span>Unconnected ideas placed: {{ placed }} (positions in this browser)</span>
    <label class="option">
      <input v-model="positionsOnly" type="checkbox" :disabled="changes.length === 0" />
      <span>Only update absolute positions (local, no file changes)</span>
    </label>
    <div class="actions">
      <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
      <button class="btn-primary" @click="emit('apply')">Apply</button>
    </div>
  </div>
</template>

<style scoped>
#layout-preview {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(28rem, calc(100% - 2rem));
  padding: 0.75rem;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: var(--font-size-small);

  & label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    &.disabled {
      opacity: 0.5;
    }

    &.option {
      flex-direction: row;
      align-items: center;
    }
  }

  & .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
}
</style>
