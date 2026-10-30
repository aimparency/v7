<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Asks before a form modal drops unsaved edits; render it inside the modal's
// FormModalShell so Escape there can map to "keep editing".
const emit = defineEmits<{
  keep: []
  discard: []
}>()

const discardBtn = ref<HTMLButtonElement>()
onMounted(() => discardBtn.value?.focus())
</script>

<template>
  <div class="discard-overlay">
    <div class="discard-prompt">
      <p class="discard-title">Discard unsaved changes?</p>
      <p class="discard-hint">You have edits that haven't been saved.</p>
      <div class="discard-actions">
        <button type="button" class="btn-cancel" @click="emit('keep')">Keep editing</button>
        <button ref="discardBtn" type="button" class="btn-discard" @click="emit('discard')">Discard</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.discard-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;

  & .discard-prompt {
    background: #2d2d2d;
    border: 1px solid #555;
    border-radius: 0.3125rem;
    padding: 1.25rem;
    max-width: min(90vw, 24rem);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  & .discard-title {
    margin: 0 0 0.5rem;
    color: #e0e0e0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  & .discard-hint {
    margin: 0 0 1rem;
    color: #aaa;
    font-size: 0.9rem;
  }

  & .discard-actions {
    display: flex;
    gap: 0.375rem;
    justify-content: flex-end;
  }

  & button {
    appearance: none;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.1875rem;
    font-size: 0.9rem;
    font-family: inherit;
    line-height: 1.2;
    cursor: pointer;
  }

  & .btn-cancel {
    background: #444;
    color: #e0e0e0;
    &:hover { background: #555; }
  }

  & .btn-discard {
    background: #6a3a3a;
    color: #fff;
    &:hover { background: #7a4545; }
  }
}
</style>
