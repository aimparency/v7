<script setup lang="ts">
import { computed } from 'vue'
import type { Aim } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

interface Props {
  isSelected: boolean
  isActive: boolean
  selectedIndex: number
}

const props = defineProps<Props>()

const dataStore = useDataStore()
const uiStore = useUIStore()

// Load uncommitted aims
const rootAims = computed(() => {
  return dataStore.getPhaseAims('null') || []
})
</script>

<template>
  <div class="root-aims-column" :class="{ 'selected-outlined': isActive || isSelected }">
    <div v-if="rootAims.length === 0" class="empty-state">
      No aims yet, create one with o
    </div>

    <div v-else class="aims-list">
      <AimComponent
        v-for="(aim, index) in rootAims"
        :key="aim.id"
        :aim="aim"
        :class="{
          'selected-outlined': index === selectedIndex || (uiStore.selectedAim?.phaseId === 'null' && uiStore.selectedAim?.aimIndex === index),
          'pending-delete': uiStore.pendingDeleteAimIndex === index && uiStore.selectedAim?.phaseId === 'null'
        }"
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

.aims-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 0.375rem;
  }

  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 0.1875rem;

    &:hover {
      background: #666;
    }
  }

  /* Firefox scrollbar */
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}

.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}
</style>
