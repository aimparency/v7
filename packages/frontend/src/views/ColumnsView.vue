<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { navigateColumnBackward, navigateColumnForward } from '../stores/ui/keyboard-actions'
import RootAimsColumn from '../components/RootAimsColumn.vue'
import Column from '../components/Column.vue'

const uiStore = useUIStore()
const dataStore = useDataStore()

const containerOffset = computed(() => {
  const columnWidth = 100 / uiStore.windowSize
  const columnsToShift = uiStore.windowStart + 1
  const offset = columnsToShift * columnWidth
  return `translateX(-${offset}%)`
})

const columnWidth = computed(() => `${100 / uiStore.windowSize}%`)

// --- Touch swipe navigation between columns ---
// Decided entirely on touchend so vertical list scrolling is never hijacked.
const SWIPE_THRESHOLD = 50 // min horizontal distance (px) to count as a swipe

let touchStartX = 0
let touchStartY = 0
let tracking = false

const onTouchStart = (event: TouchEvent) => {
  tracking = event.touches.length === 1
  if (!tracking) return
  touchStartX = event.touches[0]!.clientX
  touchStartY = event.touches[0]!.clientY
}

const onTouchMove = (event: TouchEvent) => {
  // Abort on multi-touch (pinch/zoom) so it isn't read as a swipe.
  if (event.touches.length > 1) tracking = false
}

const onTouchEnd = (event: TouchEvent) => {
  if (!tracking) return
  tracking = false

  const touch = event.changedTouches[0]
  if (!touch) return

  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY

  // Require a deliberate, horizontally-dominant swipe.
  if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return

  if (dx < 0) {
    void navigateColumnForward(uiStore, dataStore)
  } else {
    void navigateColumnBackward(uiStore)
  }
}
</script>

<template>
  <div
    class="columns-layout"
    :style="{ transform: containerOffset, '--column-width': columnWidth }"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
  >
    <RootAimsColumn class="column-aims" />

    <Column
      v-for="colIndex in [...Array(uiStore.maxColumn + 1).keys()]"
      :key="colIndex"
      :column-index="colIndex"
      class="column"
      :is-selected="uiStore.activeColumn === colIndex"
      :is-active="uiStore.activeColumn === colIndex"
      :selected-phase-index="uiStore.getRememberedPhase(colIndex)"
    />
  </div>
</template>

<style scoped>
.columns-layout {
  flex: 1;
  display: flex;
  flex-direction: row;
  position: relative;
  transition: transform 0.3s ease;
  min-height: 0;
  width: 100%;
}

.column-aims,
.column {
  flex-basis: var(--column-width);
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid #444;
}
</style>
