<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  value: string
  label?: string
  titleCopy?: string
  titleCopied?: string
}>(), {
  label: 'ID',
  titleCopy: 'Click to copy id',
  titleCopied: 'Copied'
})

const copied = ref(false)
let copiedTimeout: ReturnType<typeof setTimeout> | null = null

const copyValue = async () => {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    if (copiedTimeout) {
      clearTimeout(copiedTimeout)
    }
    copiedTimeout = setTimeout(() => {
      copied.value = false
      copiedTimeout = null
    }, 1200)
  } catch (error) {
    console.error('Failed to copy metadata id:', error)
  }
}
</script>

<template>
  <button
    class="copyable-meta-id"
    type="button"
    @click="copyValue"
    :title="copied ? titleCopied : titleCopy"
  >
    <span class="meta-id-label">{{ label }}</span>
    <code>{{ value }}</code>
    <span class="meta-id-status">{{ copied ? 'Copied' : 'Copy' }}</span>
  </button>
</template>

<style scoped>
.copyable-meta-id {
  margin-top: 0.25rem;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  border: none;
  background: transparent;
  color: #7a7a7a;
  cursor: pointer;
  font-size: 0.5rem;
}

.copyable-meta-id:hover,
.copyable-meta-id:focus {
  color: #9a9a9a;
  outline: none;
}

.copyable-meta-id code {
  font-size: 0.5rem;
  color: inherit;
}

.meta-id-label,
.meta-id-status {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.meta-id-status {
  color: #8a8a8a;
}
</style>
