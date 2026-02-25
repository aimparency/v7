<script setup lang="ts">
import { computed } from 'vue'
import { useGraphUIStore } from '../stores/ui/graph-store'
import makeCircularPath from '../utils/make-circular-path'
import * as vec2 from '../utils/vec2'

const props = defineProps<{
  link: {
    source: { id: string, x: number, y: number, r?: number, color?: string }
    target: { id: string, x: number, y: number, r?: number }
    weight?: number
    share?: number
  },
  scale?: number
}>()

const graphUIStore = useGraphUIStore()

const isVisible = computed(() => {
  return true
})

const selected = computed(() => {
  return graphUIStore.selectedLink?.parentId === props.link.source.id &&
         graphUIStore.selectedLink?.childId === props.link.target.id
})

const aimSelected = computed(() => {
  const currentAimId = graphUIStore.graphSelectedAimId
  return currentAimId === props.link.source.id || 
         currentAimId === props.link.target.id
})

const d = computed(() => {
  const { source, target } = props.link
  if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return ''
  
  const fromR = source.r || 25
  const intoR = target.r || 25
  
  // Calculate width based on share (relative weight)
  const share = props.link.share || 0
  const width = 1.2 * intoR * share 
  
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
  graphUIStore.selectLink(props.link.target.id, props.link.source.id)
}
</script>

<template>
  <path 
    v-show="isVisible"
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
