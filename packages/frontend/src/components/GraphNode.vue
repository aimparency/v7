<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  node: {
    id: string
    text: string
    status: string
    r: number
    x: number
    y: number
  }
}>()

const fillColor = computed(() => {
  switch (props.node.status) {
    case 'done': return '#00aa00'
    case 'open': return '#007acc'
    case 'cancelled': return '#ff0000'
    case 'failed': return '#ff6666'
    case 'partially': return '#aaaa00'
    default: return '#555'
  }
})

const label = computed(() => {
  return props.node.text.length > 20 
    ? props.node.text.substring(0, 18) + '...' 
    : props.node.text
})
</script>

<template>
  <g :transform="`translate(${node.x},${node.y})`" class="graph-node">
    <circle 
      :r="node.r" 
      :fill="fillColor" 
      stroke="#fff" 
      stroke-width="1.5"
      class="node-circle"
    />
    <text 
      dy="30" 
      text-anchor="middle" 
      fill="#ccc" 
      font-size="10" 
      class="node-label"
    >
      {{ label }}
    </text>
  </g>
</template>

<style scoped>
.graph-node {
  cursor: grab;
  transition: opacity 0.3s;
}

.graph-node:active {
  cursor: grabbing;
}

.node-circle {
  transition: fill 0.3s, r 0.3s;
  cursor: pointer;
}

.node-circle:hover {
  stroke: #ffff00;
  stroke-width: 2px;
}

.node-label {
  pointer-events: none;
  user-select: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
</style>
