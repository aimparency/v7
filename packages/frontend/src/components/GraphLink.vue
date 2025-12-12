<script setup lang="ts">
const props = defineProps<{
  link: {
    source: { x: number, y: number }
    target: { x: number, y: number }
  }
}>()
</script>

<template>
  <line 
    :x1="props.link.source.x" 
    :y1="props.link.source.y" 
    :x2="props.link.target.x" 
    :y2="props.link.target.y"
    stroke="#555" 
    stroke-width="1.5"
    class="graph-link"
  />
</template>

<style scoped>
.graph-link {
  transition: stroke-width 0.2s;
}
</style>
