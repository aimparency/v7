<script setup lang="ts">
import { useToastStore } from '../stores/toast'
import { X } from 'lucide-vue-next'

const toastStore = useToastStore()
</script>

<template>
  <!-- Never takes focus: keyboard navigation of the graph and lists keeps working. -->
  <div id="toast-stack" aria-live="polite">
    <div
      v-for="toast in toastStore.toasts"
      :key="toast.id"
      :class="['toast', toast.kind]"
      :role="toast.kind === 'error' ? 'alert' : 'status'"
    >
      <span class="message">{{ toast.message }}</span>
      <span v-if="toast.count > 1" class="count">×{{ toast.count }}</span>
      <button tabindex="-1" title="Dismiss" @click="toastStore.dismiss(toast.id)"><X /></button>
    </div>
  </div>
</template>

<style scoped>
#toast-stack {
  position: fixed;
  right: 1rem;
  bottom: 3rem;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: min(28rem, calc(100vw - 2rem));
  pointer-events: none;

  & .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #2a2a2a;
    border: 1px solid #555;
    border-left-width: 4px;
    border-radius: 4px;
    font-size: var(--font-size-small);
    pointer-events: auto;

    &.info { border-left-color: var(--status-open); }
    &.warning { border-left-color: var(--status-unclear); }
    &.error { border-left-color: var(--status-failed); }
  }

  & .message { flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; }
  & .count { color: #aaa; }

  & button {
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
}
</style>
