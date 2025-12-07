<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  modelValue: string[]
  label?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', tags: string[]): void
  (e: 'next-field'): void
  (e: 'prev-field'): void
}>()

const input = ref('')
const inputElement = ref<HTMLInputElement>()

function addTag() {
  if (input.value) {
    const cleaned = input.value.trim()
    // Prevent duplicates
    if (!props.modelValue.includes(cleaned)) {
      emit('update:modelValue', [...props.modelValue, cleaned])
    }
    input.value = ''
    // Keep focus
    setTimeout(() => {
      inputElement.value?.focus()
    }, 10)
  }
}

function removeTag(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag))
}

function removePreviousIfEmpty() {
  if (input.value === '' && props.modelValue.length > 0) {
    removeTag(props.modelValue[props.modelValue.length - 1])
  }
}

const maxTagLength = 25
function ensureMaxLength() {
  if (input.value.length > maxTagLength) {
    input.value = input.value.slice(0, maxTagLength)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addTag()
    return
  }

  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (input.value === '') {
        e.preventDefault()
        emit('prev-field')
      }
    } else {
      if (input.value !== '') {
        e.preventDefault()
        addTag()
      } else {
        e.preventDefault()
        emit('next-field')
      }
    }
    return
  }

  if (e.key === 'Backspace') {
    removePreviousIfEmpty()
    return
  }
}

// Handle t() replacement simply for now
const t = (key: string) => key === 'common.add' ? 'Add' : key

</script>

<template>
  <div class="area">
    <div class="label"> {{ label ?? 'Tags:' }} </div>
    <div v-for="tag in modelValue" :key="tag" class="tag">
      {{ tag }}
      <button class="x" @click="removeTag(tag)">✖</button>
    </div>
    <div class="no-wrap">
      <input 
        ref="inputElement"
        @input="ensureMaxLength"
        type="text" v-model="input"  
        @keydown="handleKeydown"
      />
      <button @click="addTag" class="add">{{ t('common.add') }}</button>
    </div>
  </div>
</template>

<style scoped>
.label {
  display: inline-block;
  margin-left: 0.25rem;
  color: #ccc;
  font-weight: bold;
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
}
input, .tag, .add {
  display: inline-block;
  padding: 0.3rem 0.6rem; 
  border-radius: 1rem;
  border: none;
  margin: 0.15rem; 
  min-width: 0;
  font-size: 0.8rem;
}
.add {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ccc;
  cursor: pointer;
}
.add:hover {
  background-color: rgba(255, 255, 255, 0.2);
}
.area {
  width: 100%;
  padding: 0.5rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid #555;
  border-radius: 0.3rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;

  .no-wrap {
    display: inline-flex;
    align-items: center;
    flex-grow: 1;
    
    & input {
      border: none;
      background-color: transparent;
      color: #e0e0e0;
      outline: none;
      flex-grow: 1;
      font-family: monospace;
    }
  }
  .tag {
    position: relative;
    background-color: rgba(0, 122, 204, 0.3);
    color: #88ccff;
    padding-right: 1.8rem;
    
    & .x {
      position: absolute;
      right: 0.2rem;
      top: 50%;
      margin: 0;
      transform: translateY(-50%);
      width: 1.2rem;
      height: 1.2rem;
      border: none;
      background: none;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      opacity: 0.7;
      
      &:hover {
        opacity: 1;
      }
    }
  }
}
</style>
