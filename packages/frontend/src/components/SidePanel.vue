<script setup lang="ts">
import { onUnmounted } from 'vue'
import { useGraphUIStore } from '../stores/ui/graph-store'

// The panel at the graph's right edge, resizable from its left edge. The
// idea details and the Layout panel take turns in it and share its width.
const graphUIStore = useGraphUIStore()

// Width = window width − mouse x − right margin (20)
const onResize = (event: MouseEvent) => graphUIStore.setGraphPanelWidth(window.innerWidth - event.clientX - 20)
const stopResize = () => {
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}
const startResize = (event: MouseEvent) => {
  event.preventDefault()
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}
onUnmounted(stopResize)
</script>

<template>
  <div class="side-panel" :style="{ width: `${graphUIStore.graphPanelWidth}px` }">
    <div class="resize-handle" @mousedown="startResize"></div>
    <slot />
  </div>
</template>

<style scoped>
.side-panel {
  position: absolute;
  right: 20px;
  top: 20px;
  z-index: 100;
  display: flex;
  max-width: calc(100% - 40px);
  max-height: calc(100% - 40px);
  overflow: hidden;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;

  & .resize-handle {
    flex-shrink: 0;
    width: 15px;
    cursor: ew-resize;
    transition: background 0.2s;
  }

  &:hover .resize-handle {
    background: rgba(255, 255, 255, 0.05);
  }
}
</style>
