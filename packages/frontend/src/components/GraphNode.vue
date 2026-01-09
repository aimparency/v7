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
    color?: string
  },
  selected?: boolean
}>()

const fillColor = computed(() => {
  if (props.node.color) return props.node.color
  
  switch (props.node.status) {
    case 'done': return '#007700'
    case 'open': return '#00558e'
    case 'cancelled': return '#b20000'
    case 'failed': return '#b24747'
    case 'partially': return '#777700'
    case 'unclear': return '#b27300'
    case 'archived': return '#3b3b3b'
    default: return '#3b3b3b'
  }
})

const titleLines = computed(() => {
  const words = props.node.text.split(' ')
  const lines: string[] = []
  let currentLine = words[0] || ''
  
  // Heuristic: 12 chars per line
  const maxChars = 12
  
  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    if (word === undefined) continue
    
    if (currentLine.length + 1 + word.length <= maxChars) {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }
  lines.push(currentLine)
  
  if (lines.length > 4) {
    lines.length = 3
    lines[2] += '...'
  }
  return lines
})
</script>

<template>
  <g :transform="`translate(${node.x},${node.y})`" class="graph-node">
    <g :transform="`scale(${node.r})`">
      <circle 
        r="1" 
        :fill="fillColor" 
        class="node-circle"
        :class="{ selected }"
      />
      <text 
        dominant-baseline="central"
        text-anchor="middle" 
        fill="#fff" 
        font-size="0.25" 
        class="node-label"
      >
        <tspan 
          v-for="(line, i) in titleLines" 
          :key="i"
          x="0"
          :dy="i === 0 ? (-(titleLines.length - 1) * 0.6) + 'em' : '1.2em'"
        >
          {{ line }}
        </tspan>
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
  transition: stroke-width 0.2s ease-in-out;
  cursor: pointer;
  stroke: #ffffff;
  stroke-width: 0;
  paint-order: stroke;
}

.node-circle:hover {
  stroke-width: 0.15;
}

.node-circle.selected {
  stroke-width: 0.15;
}

.node-label {
  pointer-events: none;
  user-select: none;
}
</style>
