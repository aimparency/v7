<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import FormModalShell from './FormModalShell.vue'
import { useUIModalStore, type IdeaRemovalRequest } from '../stores/ui/modal-store'
import { useDataStore } from '../stores/data'

const props = defineProps<{ request: IdeaRemovalRequest }>()

const modalStore = useUIModalStore()
const dataStore = useDataStore()

const SHOWN_IDEAS = 8

const textOf = (ideaId: string) => {
  const idea = dataStore.ideas[ideaId]
  return idea ? idea.text || '(untitled)' : ideaId.slice(0, 8)
}
const subject = computed(() => props.request.ideaIds.length === 1
  ? `“${textOf(props.request.ideaIds[0]!)}”`
  : `${props.request.ideaIds.length} ideas`)
const subIdeaCount = computed(() => props.request.cascadeIds.length - props.request.ideaIds.length)

const keepLabel = computed(() => props.request.fromLabel
  ? `Remove from “${props.request.fromLabel}”, keep it floating`
  : `Delete only ${subject.value}; sub-ideas stay`)
const cascadeLabel = computed(() => subIdeaCount.value > 0
  ? `Delete ${subject.value} and ${subIdeaCount.value} sub-idea${subIdeaCount.value === 1 ? '' : 's'} nothing else holds`
  : `Delete ${subject.value}`)

// Capture phase: the dialog owns the keyboard, nothing leaks to list or graph keys.
const handleKeydown = (event: KeyboardEvent) => {
  event.stopPropagation()
  const choice = { r: 'keep', x: 'cascade', Escape: null }[event.key]
  if (choice === undefined) return
  event.preventDefault()
  modalStore.answerIdeaRemoval(choice as 'keep' | 'cascade' | null)
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))
</script>

<template>
  <FormModalShell
    :show="true"
    :title="request.fromLabel ? 'Remove idea' : 'Delete ideas'"
    width="min(90vw, 32rem)"
    @request-close="modalStore.answerIdeaRemoval(null)"
  >
    <div id="idea-removal">
      <p v-if="request.fromLabel">{{ subject }} is in no other parent or phase.</p>
      <template v-if="subIdeaCount > 0">
        <p class="warning">Deleting the subtree takes {{ request.cascadeIds.length }} ideas:</p>
        <ul>
          <li v-for="ideaId in request.cascadeIds.slice(0, SHOWN_IDEAS)" :key="ideaId">{{ textOf(ideaId) }}</li>
          <li v-if="request.cascadeIds.length > SHOWN_IDEAS">… and {{ request.cascadeIds.length - SHOWN_IDEAS }} more</li>
        </ul>
      </template>
      <div class="choices">
        <button @click="modalStore.answerIdeaRemoval('keep')"><kbd>r</kbd>{{ keepLabel }}</button>
        <button class="danger" @click="modalStore.answerIdeaRemoval('cascade')"><kbd>x</kbd>{{ cascadeLabel }}</button>
        <button @click="modalStore.answerIdeaRemoval(null)"><kbd>Esc</kbd>Cancel</button>
      </div>
    </div>
  </FormModalShell>
</template>

<style scoped>
#idea-removal {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  & p { margin: 0; }
  & .warning { color: #e0a040; }
  & ul { margin: 0; padding-left: 1.25rem; color: #aaa; }

  & .choices {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    & button {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      padding: 0.5rem 0.75rem;
      text-align: left;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      cursor: pointer;

      &:hover { border-color: #888; }
      &.danger:hover { border-color: #c44; }
    }

    & kbd {
      min-width: 2.5rem;
      color: #999;
      font-family: monospace;
    }
  }
}
</style>
