<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const inputRef = ref<HTMLInputElement>()

const handleInput = (e: Event) => {
  let val = (e.target as HTMLInputElement).value
  
  // Simple masking/formatting
  val = val.replace(/[^0-9:]/g, '')
  
  if (val.length === 2 && !val.includes(':') && !props.modelValue.endsWith(':')) {
    val += ':'
  }
  
  emit('update:modelValue', val)
}

const handleBlur = (e: Event) => {
  let val = (e.target as HTMLInputElement).value
  
  // Validate and format
  const parts = val.split(':')
  if (parts.length === 1 && val.length === 4) {
      // 1230 -> 12:30
      val = val.substring(0, 2) + ':' + val.substring(2, 4)
  }
  
  const match = val.match(/^(\d{1,2}):(\d{1,2})$/)
  if (match) {
    let h = parseInt(match[1]!)
    let m = parseInt(match[2]!)
    
    if (h > 23) h = 23
    if (m > 59) m = 59
    
    val = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    emit('update:modelValue', val)
  } else {
    // Invalid? Reset to 00:00 or keep raw? 
    // If empty, leave empty.
    if (val.trim()) {
        emit('update:modelValue', '00:00')
    }
  }
}
</script>

<template>
  <input 
    ref="inputRef"
    type="text" 
    :value="modelValue" 
    @input="handleInput"
    @blur="handleBlur"
    class="time-input"
    placeholder="HH:mm"
    maxlength="5"
  />
</template>

<style scoped>
.time-input {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
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
</style>