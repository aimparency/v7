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
    <g :transform="`scale(${node.r})`">
      <circle 
        r="1" 
        :fill="fillColor" 
        stroke="#fff" 
        stroke-width="0.075"
        class="node-circle"
      />
      <text 
        dy="0" 
        dominant-baseline="central"
        text-anchor="middle" 
        fill="#fff" 
        font-size="0.25" 
        class="node-label"
      >
        {{ label }}
      </text>
    </g>
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
  transition: stroke 0.2s ease-in-out;
  cursor: pointer;
  stroke: #ccc0;
}

.node-circle:hover {
  stroke: #cccf;
}

.node-label {
  pointer-events: none;
  user-select: none;
}
</style>
