<script setup lang="ts">
import { computed } from 'vue'
import { useMapStore } from '../stores/map'
import { useUIStore } from '../stores/ui'
import * as vec2 from '../utils/vec2'

const props = defineProps<{
  link: {
    source: { id: string, pos: vec2.T, r?: number }
    target: { id: string, pos: vec2.T, r?: number }
    relativePosition: vec2.T
  },
  sourcePos: vec2.T,
  targetPos: vec2.T,
  sourceR: number,
  targetR: number
}>()

const mapStore = useMapStore()
const uiStore = useUIStore()

// Computeds using reactive props
const M = computed(() => {
  const rSum = props.sourceR + props.targetR
  return vec2.fromValues(
    (props.sourcePos[0] * props.sourceR + props.targetPos[0] * props.targetR)/rSum,
    (props.sourcePos[1] * props.sourceR + props.targetPos[1] * props.targetR)/rSum
  )
})

const intoHandlePos = computed(() => {
  return vec2.crAdd(M.value, vec2.crScale(props.link.relativePosition, props.sourceR))
})

const fromHandlePos = computed(() => {
  return vec2.crSub(M.value, vec2.crScale(props.link.relativePosition, props.targetR))
})

const startLayouting = (from: boolean) => {
  const rSum = props.sourceR + props.targetR
  mapStore.startLayouting({
    fromWeight: props.sourceR / rSum,
    start: from ? fromHandlePos.value : intoHandlePos.value,
    dScale: from ? -1 / props.targetR : 1 / props.sourceR,
    link: props.link 
  })
}

const selectAim = (aimId: string) => {
  if (!mapStore.cursorMoved) {
    uiStore.setGraphSelection(aimId)
  }
}
</script>

<template>
  <g class="flow-handle-group" :class="{ dragging: mapStore.layouting }">
    <!-- Line -->
    <line 
      class="handle line" 
      :x1="fromHandlePos[0]" 
      :y1="fromHandlePos[1]" 
      :x2="intoHandlePos[0]" 
      :y2="intoHandlePos[1]" 
      :stroke-width="sourceR * 0.15" 
    />
    <!-- From Handle -->
    <circle 
      class="handle" 
      :cx="fromHandlePos[0]" 
      :cy="fromHandlePos[1]" 
      :r="sourceR" 
      :stroke-width="sourceR * 0.05"
      @mousedown="startLayouting(true)" 
      @touchstart="startLayouting(true)"
      @click.stop="selectAim(link.source.id)"
    />
    <!-- Into Handle -->
    <circle 
      class="handle" 
      :cx="intoHandlePos[0]" 
      :cy="intoHandlePos[1]" 
      :r="targetR"
      :stroke-width="targetR * 0.05"
      @mousedown="startLayouting(false)" 
      @touchstart="startLayouting(false)"
      @click.stop="selectAim(link.target.id)"
    />
  </g>
</template>

<style scoped>
.flow-handle-group {
  opacity: 0.3;
  transition: opacity 0.2s;
}
.flow-handle-group:hover, .flow-handle-group.dragging {
  opacity: 0.8;
}

.handle {
  fill: #fff; 
  stroke: #fff;
  stroke-linecap: round;
  cursor: pointer; 
}
.handle.line {
  pointer-events: none;
}
</style>