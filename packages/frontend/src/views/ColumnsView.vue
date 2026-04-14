<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '../stores/ui'
import RootAimsColumn from '../components/RootAimsColumn.vue'
import Column from '../components/Column.vue'

const uiStore = useUIStore()

const containerOffset = computed(() => {
  const columnWidth = 100 / uiStore.windowSize
  const columnsToShift = uiStore.windowStart + 1
  const offset = columnsToShift * columnWidth
  return `translateX(-${offset}%)`
})

const columnWidth = computed(() => `${100 / uiStore.windowSize}%`)
</script>

<template>
  <div
    class="columns-layout"
    :style="{ transform: containerOffset, '--column-width': columnWidth }"
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
