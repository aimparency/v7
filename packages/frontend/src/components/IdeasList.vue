<script setup lang="ts">
import { ref, watch } from 'vue'
import draggable from 'vuedraggable'
import type { Idea } from '../stores/data'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import type { IdeaUIStateTree } from '../stores/ui/idea-ui-state'
import IdeaComponent from './Idea.vue'

interface Props {
  ideas: Idea[]
  phaseId: string
  columnIndex: number
  isActive: boolean
  isSelected: boolean
  indentationLevel?: number
  selectedAimIndex?: number  // Index of selected idea in this list
  parentAimId?: string
  ideaUiStates: IdeaUIStateTree
}

const props = withDefaults(defineProps<Props>(), {
  indentationLevel: 0,
  selectedAimIndex: undefined,
  parentAimId: undefined
})

const emit = defineEmits<{
  'idea-clicked': [ideaId: string, modifiers?: { ctrl: boolean; shift: boolean }]
  'scroll-request': [element: HTMLElement]
}>()

const uiStore = useUIStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()
const dataStore = useDataStore()
const ideasListRef = ref<HTMLElement | null>(null)
const localAims = ref<Idea[]>([...props.ideas])

watch(() => props.ideas, (newVal) => {
  localAims.value = [...newVal]
})

const handleChange = async (event: any) => {
  if (event.moved) {
    const { newIndex, element } = event.moved
    const ideaId = element.id
    
    if (props.parentAimId) {
      await dataStore.reorderSubAim(projectStore.projectPath, props.parentAimId, ideaId, newIndex)
    } else {
      await dataStore.reorderPhaseAim(projectStore.projectPath, props.phaseId, ideaId, newIndex)
    }
  }
}

// Handle scroll requests from child ideas
const handleScrollRequest = (element: HTMLElement) => {
  // Forward to parent (column) for scrolling
  emit('scroll-request', element)
}

const handleAimClickedInList = (ideaId: string, mods?: { ctrl: boolean; shift: boolean }) => {
  const isShift = !!(mods && mods.shift)
  if (isShift) {
    // Range within this sub-list's ideas
    const ordered = localAims.value.map((a: any) => a.id)
    uiStore.selectMultiRange(ideaId, ordered)
  }
  // Always forward for primary selection / higher level handling (ctrl handled higher too if needed)
  emit('idea-clicked', ideaId, mods)
}
</script>

<template>
  <div ref="ideasListRef" class="ideas-list-wrapper">
    <draggable
      v-model="localAims"
      item-key="id"
      group="ideas"
      @change="handleChange"
      class="ideas-list"
      handle=".idea-content" 
    >
      <template #item="{ element: idea, index }">
        <IdeaComponent
          :key="idea.id"
          :idea="idea"
          :phase-id="phaseId"
          :column-index="columnIndex"
          :indentation-level="indentationLevel"
          :is-active="isActive"
          :is-selected="isSelected"
          :is-this-idea-selected="selectedAimIndex === index"
          :parent-idea-id="parentAimId"
          :idea-ui-state="uiStore.ensureAimUIState(ideaUiStates, idea.id)"
          :class="{
            'active': isActive && selectedAimIndex === index,
            'selected': isSelected && selectedAimIndex === index,
            'pending-delete': uiStore.ensureAimUIState(ideaUiStates, idea.id).pendingDelete,
            'moving': modalStore.movingAimId === idea.id
          }"
          @scroll-request="handleScrollRequest"
          @idea-clicked="(id, mods) => handleAimClickedInList(id, mods)"
        />
      </template>
      <template #footer>
         <div v-if="ideas.length === 0" class="empty-hint">
          No ideas yet
        </div>
      </template>
    </draggable>
  </div>
</template>

<style scoped>
.ideas-list-wrapper {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
}

.ideas-list {
  flex: 1;
  min-height: 0;
}

.empty-hint {
  font-size: 0.7rem;
  color: #666;
  font-style: italic;
  padding: 0.25rem 0;
}
</style>
