<script setup lang="ts">
import { computed } from 'vue'
import makeCircularPath from '../utils/make-circular-path'
import * as vec2 from '../utils/vec2'

const props = defineProps<{
  link: {
    source: { x: number, y: number, r?: number, color?: string }
    target: { x: number, y: number, r?: number }
    weight?: number
  }
}>()

const d = computed(() => {
  const { source, target } = props.link
  if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return ''
  
  const fromR = source.r || 25
  const intoR = target.r || 25
  
  // Calculate width based on weight
  // Reference: 0.2 * this.flow.into.r * this.flow.share
  const weight = props.link.weight || 1
  const width = 0.2 * intoR * Math.min(1, weight * 0.5) // Scaling factor
  
  return makeCircularPath(
    { pos: [source.x, source.y], r: fromR },
    width,
    { pos: [target.x, target.y], r: intoR }
  ) || ''
})

const fillColor = computed(() => {
    // Reference uses from.color.
    // Our nodes might not have color yet. Use a default.
    return props.link.source.color || '#888'
})

const opacity = computed(() => {
    const w = props.link.weight || 1
    return Math.min(1, 0.4 + w * 0.2)
})
</script>

<template>
  <path 
    :d="d" 
    class="graph-link"
    :fill="fillColor"
    :fill-opacity="opacity"
  />
</template>

<style scoped>
.graph-link {
  transition: fill-opacity 0.3s;
  cursor: pointer;
}
.graph-link:hover {
  fill-opacity: 0.8 !important;
  fill: #fff;
}
</style>