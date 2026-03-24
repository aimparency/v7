<script setup lang="ts">
import { ref, watch, useAttrs } from 'vue'

defineOptions({
  inheritAttrs: false
})

const props = defineProps<{
  modelValue: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

const attrs = useAttrs()
const inputElement = ref<HTMLInputElement | null>(null)
const inputValue = ref(formatValue(props.modelValue))

watch(() => props.modelValue, (value) => {
  if (document.activeElement === inputElement.value) return
  inputValue.value = formatValue(value)
})

function formatValue(value: number) {
  return Number.isFinite(value) ? String(value) : ''
}

function parseValue(raw: string) {
  const normalized = raw.replace(',', '.').trim()
  if (!normalized) return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement
  inputValue.value = target.value

  const parsed = parseValue(target.value)
  if (parsed !== null) {
    emit('update:modelValue', parsed)
  }
}

function handleBlur() {
  const parsed = parseValue(inputValue.value)

  if (parsed === null) {
    inputValue.value = formatValue(props.modelValue)
    return
  }

  inputValue.value = formatValue(parsed)

  if (parsed !== props.modelValue) {
    emit('update:modelValue', parsed)
  }
}
</script>

<template>
  <input
    ref="inputElement"
    :value="inputValue"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    v-bind="attrs"
    @input="handleInput"
    @blur="handleBlur"
  />
</template>
