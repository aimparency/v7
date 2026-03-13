<script setup lang="ts">
import { computed } from 'vue'
import { useMapStore } from '../stores/map'
import makeCircularPath from '../utils/make-circular-path'

const mapStore = useMapStore()

const path = computed(() => {
  if (!mapStore.connectFrom) return ''
  return makeCircularPath(
    {
      pos: mapStore.mouse.logical,
      r: 0
    }, 
    0.5 * mapStore.connectFrom.r,
    {
      pos: mapStore.connectFrom.pos,
      r: mapStore.connectFrom.r
    }
  )
})
</script>

<template>
  <path
    v-if="mapStore.connectFrom"
    class="connector"
    :d="path"
    :stroke-width="mapStore.connectFrom.r"
  />
</template>

<style scoped>
.connector{
  fill: #808080;
  fill-opacity: 0.6;
  mix-blend-mode: lighten;
  pointer-events: none;
}
</style>
