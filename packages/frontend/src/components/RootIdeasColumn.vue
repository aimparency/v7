<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useScrollIntoView } from '../composables/useScrollIntoView'
import { useKeepSelectedIdeaVisible } from '../composables/useKeepSelectedIdeaVisible'
import IdeasList from './IdeasList.vue'

const dataStore = useDataStore()
const uiStore = useUIStore()

const isSelected = computed(() => uiStore.activeColumn === -1)
const isActive = computed(() => uiStore.activeColumn === -1)

const rootColumnRef = ref<HTMLElement | null>(null)

// Handle scroll requests from child ideas
const { handleScrollRequest } = useScrollIntoView(rootColumnRef)
useKeepSelectedIdeaVisible(rootColumnRef, () => isActive.value, handleScrollRequest)

const handleIdeaClicked = (columnIndex: number, phaseId: string | undefined, ideaId: string, mods?: { ctrl: boolean; shift: boolean }) => {
  const isCtrl = !!(mods && mods.ctrl)
  const isShift = !!(mods && mods.shift)
  const isModeToggle = uiStore.multiSelectMode && !isShift
  if (isShift) {
    const ordered = dataStore.floatingIdeas.map((a: any) => a.id)
    uiStore.selectMultiRange(ideaId, ordered)
  } else if (isCtrl || isModeToggle) {
    uiStore.toggleMultiSelect(ideaId)
  } else {
    uiStore.clearMultiSelect()
  }
  if ((isCtrl || isShift || isModeToggle) && uiStore.getCurrentIdea()?.id === ideaId) return
  uiStore.selectIdeaById(columnIndex, phaseId, ideaId).catch(() => {})
}
</script>

<template>
  <div class="root-ideas-column" :class="{ 'active': isActive, 'selected': isSelected }">
    <div 
      ref="rootColumnRef" 
      class="ideas-container"
    >
      <div class="info">free floating ideas</div>
      <IdeasList
        :ideas="dataStore.floatingIdeas"
        phase-id=""
        :column-index="-1"
        :is-active="isActive && uiStore.navigatingIdeas"
        :is-selected="isSelected"
        :selected-idea-index="uiStore.floatingIdeaIndex"
        :idea-ui-states="uiStore.floatingIdeaUIStates"
        @idea-clicked="(ideaId, mods) => handleIdeaClicked(-1, undefined, ideaId, mods)"
        @scroll-request="handleScrollRequest"
      />
    </div>
  </div>
</template>

<style scoped>
.root-ideas-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ideas-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  padding: 0 0.5rem 0.5rem 0.5rem;
}

.root-ideas-column.selected {
  outline-width: 0.15rem;
  outline-style: solid;
  outline-offset: -0.15rem;
  outline-color: #888;

  &.active {
    outline-color: #007acc;
  }
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
