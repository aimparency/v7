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
  },
  selected?: boolean
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

const titleLines = computed(() => {
  const words = props.node.text.split(' ')
  const lines: string[] = []
  let currentLine = words[0] || ''
  
  // Heuristic: 12 chars per line
  const maxChars = 12
  
  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    if (currentLine.length + 1 + word.length <= maxChars) {
      currentLine += ' ' + word
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
        stroke="#fff" 
        stroke-width="0.075"
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
          :dy="i === 0 ? (-0.3 * (titleLines.length - 1) / 2) + 'em' : '1.2em'"
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
  transition: stroke 0.2s ease-in-out;
  cursor: pointer;
  stroke: #ccc0;
}

.node-circle:hover {
  stroke: #cccf;
}

.node-circle.selected {
  stroke: #fff;
  stroke-width: 0.15;
}

.node-label {
  pointer-events: none;
  user-select: none;
}
</style>
