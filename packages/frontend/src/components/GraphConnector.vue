<script setup lang="ts">
import { useMapStore } from '../stores/map'

const mapStore = useMapStore()
</script>

<template>
  <line 
    v-if="mapStore.connectFrom"
    class="connector"
    :x1="mapStore.connectFrom.pos[0]" 
    :y1="mapStore.connectFrom.pos[1]" 
    :x2="mapStore.mouse.logical[0]" 
    :y2="mapStore.mouse.logical[1]" 
    stroke="#88ccff" 
    stroke-width="2" 
    stroke-dasharray="5,5"
  />
</template>

<style scoped>
.connector {
  pointer-events: none;
  opacity: 0.8;
}
</style>