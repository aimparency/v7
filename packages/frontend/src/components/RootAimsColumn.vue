<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useScrollIntoView } from '../composables/useScrollIntoView'
import AimsList from './AimsList.vue'

const dataStore = useDataStore()
const uiStore = useUIStore()

const isSelected = computed(() => uiStore.selectedColumn === -1)
const isActive = computed(() => uiStore.selectedColumn === -1)

const rootColumnRef = ref<HTMLElement | null>(null)

// Handle scroll requests from child aims
const { handleScrollRequest } = useScrollIntoView(rootColumnRef)
</script>

<template>
  <div class="root-aims-column" :class="{ 'selected-outlined': isActive, 'selected': isSelected }">
    <div ref="rootColumnRef" class="aims-container">
      <div class="info">free floating aims</div>
      <AimsList
        :aims="dataStore.floatingAims"
        phase-id=""
        :column-index="-1"
        :is-active="isActive && uiStore.navigatingAims"
        :is-selected="isSelected && uiStore.navigatingAims"
        :selected-aim-index="uiStore.floatingAimIndex"
        @aim-clicked="(aimId) => uiStore.selectAimById(-1, undefined, aimId)"
        @scroll-request="handleScrollRequest"
      />
    </div>
  </div>
</template>

<style scoped>
.root-aims-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.aims-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  padding: 0 0.5rem 0.5rem 0.5rem;
}

.root-aims-column.selected {
  outline: 2px solid #888;
}

.root-aims-column.selected-outlined {
  outline: 2px solid #007acc;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}

.info {
  font-size: 0.8rem;
  color: #fff4;
  text-align: center;
  margin-top: 0.5rem;
}
</style>
