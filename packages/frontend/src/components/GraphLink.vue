<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '../stores/ui'
import makeCircularPath from '../utils/make-circular-path'
import * as vec2 from '../utils/vec2'

const props = defineProps<{
  link: {
    source: { id: string, x: number, y: number, r?: number, color?: string }
    target: { id: string, x: number, y: number, r?: number }
    weight?: number
  }
}>()

const uiStore = useUIStore()

const selected = computed(() => {
  return uiStore.selectedLink?.parentId === props.link.source.id &&
         uiStore.selectedLink?.childId === props.link.target.id
})

const aimSelected = computed(() => {
  const currentAim = uiStore.getCurrentAim()
  return currentAim?.id === props.link.source.id || 
         currentAim?.id === props.link.target.id
})

const d = computed(() => {
  const { source, target } = props.link
  if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return ''
  
  const fromR = source.r || 25
  const intoR = target.r || 25
  
  // Calculate width based on weight
  // Reference: 0.2 * this.flow.into.r * this.flow.share
  const weight = props.link.weight || 1
  const width = 0.2 * intoR * Math.min(1, weight) // Scaling factor
  
  return makeCircularPath(
    { pos: [source.x, source.y], r: fromR },
    width,
    { pos: [target.x, target.y], r: intoR }
  ) || ''
})

const fillColor = computed(() => {
    return props.link.source.color || '#888'
})

const opacity = computed(() => {
    const w = props.link.weight || 1
    return Math.min(1, 0.4 + w * 0.2)
})

const select = () => {
  uiStore.selectLink(props.link.source.id, props.link.target.id)
}
</script>

<template>
  <path 
    :d="d" 
    class="graph-link"
    :class="{ selected, aimSelected }"
    :fill="fillColor"
    :fill-opacity="opacity"
    @click.stop="select"
  />
</template>

<style scoped>
.graph-link {
  transition: fill-opacity 0.3s, stroke 0.2s ease, opacity 0.2s ease;
  cursor: pointer;
  mix-blend-mode: lighten;
  stroke: transparent;
  opacity: 0.5;
}
.graph-link:hover {
  opacity: 0.75;
  stroke: #ffff;
  stroke-width: 1px;
}
.graph-link.selected {
  transition: none;
  stroke: #ffff;
  opacity: 0.75;
}
.graph-link.aimSelected {
  opacity: 0.75;
}
</style>