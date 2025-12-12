<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  link: {
    source: { x: number, y: number }
    target: { x: number, y: number }
    weight?: number
  }
}>()

const d = computed(() => {
  const { source, target } = props.link
  if (!source || !target) return ''
  return `M${source.x},${source.y} L${target.x},${target.y}`
})

const strokeWidth = computed(() => {
  const w = props.link.weight || 1
  return Math.max(1, w * 2) // Base width + scaling
})

const opacity = computed(() => {
    const w = props.link.weight || 1
    return Math.min(1, 0.3 + w * 0.1) // Base 0.3 + scaling, max 1
})
</script>

<template>
  <path 
    :d="d" 
    class="graph-link"
    :stroke-width="strokeWidth"
    :stroke-opacity="opacity"
  />
</template>

<style scoped>
.graph-link {
  stroke: #555;
  fill: none;
  transition: stroke-width 0.3s, stroke-opacity 0.3s;
}
</style>