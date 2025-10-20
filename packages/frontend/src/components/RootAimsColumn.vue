<script setup lang="ts">
import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimsList from './AimsList.vue'

const dataStore = useDataStore()
const uiStore = useUIStore()

const isSelected = computed(() => uiStore.selectedColumn === -1)
const isActive = computed(() => uiStore.selectedColumn === -1)

// Load uncommitted aims
const rootAims = computed(() => {
  return dataStore.getAimsForPhase('null') || []
})
</script>

<template>
  <div class="root-aims-column" :class="{ 'selected-outlined': isActive, 'selected': isSelected }">
    <div v-if="rootAims.length === 0" class="empty-state">
      No aims yet, create one with o
    </div>

    <template v-else>
      <div class="info">free floating aims</div>
      <AimsList
        :aims="rootAims"
        phase-id="null"
        :column-index="-1"
        :is-active="isActive"
        :is-selected="isSelected"
        @aim-clicked="(aimId) => uiStore.selectAimById(-1, 'null', aimId)"
      />
    </template>
  </div>
</template>

<style scoped>
.root-aims-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
