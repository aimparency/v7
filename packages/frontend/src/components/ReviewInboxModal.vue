<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import FormModalShell from './FormModalShell.vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { AWAITING_HUMAN_STATES, DEFAULT_AWAITING_HUMAN_STATES, firstAppearanceOrder, rankIdeasAwaitingHuman, sortChronologically } from '../utils/review-inbox'
import { formatIdeaPriority } from '../utils/phase-priority'
import { isReadOnlyError } from '../utils/read-only'
import { useToastStore } from '../stores/toast'
import type { IdeaState } from 'shared'

const emit = defineEmits<{ close: [] }>()

const dataStore = useDataStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()

const shownStates = ref<string[]>([...DEFAULT_AWAITING_HUMAN_STATES])
// Chronological: in the order the ideas first appear in the phases.
const ORDERS = ['priority', 'chronological'] as const
const order = ref<(typeof ORDERS)[number]>('priority')
const selectedIndex = ref(0)
const sendBackReason = ref<string | null>(null)
const error = ref('')
const listRef = ref<HTMLElement | null>(null)
const reasonInput = ref<HTMLInputElement | null>(null)

const allEntries = computed(() => rankIdeasAwaitingHuman(dataStore.ideas, dataStore.calculatedPriorities, AWAITING_HUMAN_STATES))
const entries = computed(() => {
  const shown = allEntries.value.filter(entry => shownStates.value.includes(entry.idea.status.state))
  if (order.value === 'priority') return shown
  return sortChronologically(shown, firstAppearanceOrder(dataStore.phases, dataStore.meta?.rootPhaseIds ?? [], dataStore.ideas))
})
const countOf = (state: string) => allEntries.value.filter(entry => entry.idea.status.state === state).length
const toggleState = (state: string) => {
  shownStates.value = shownStates.value.includes(state)
    ? shownStates.value.filter(shown => shown !== state)
    : [...shownStates.value, state]
}
const selected = computed(() => entries.value[selectedIndex.value] ?? null)
const statusColor = (state: string) => dataStore.getStatuses.find((status: IdeaState) => status.key === state)?.color ?? '#888'

// Deciding removes the idea from the list; stay at the same position.
watch(entries, list => { selectedIndex.value = Math.min(selectedIndex.value, Math.max(list.length - 1, 0)) })
watch([shownStates, order], () => { selectedIndex.value = 0 })
watch(selectedIndex, async () => {
  await nextTick()
  listRef.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
})

const setStatus = async (state: string, comment: string) => {
  const idea = selected.value?.idea
  if (!idea) return
  error.value = ''
  try {
    await dataStore.updateIdea(projectStore.projectPath, idea.id, { status: { ...idea.status, state, comment } })
  } catch (failure) {
    if (isReadOnlyError(failure)) useToastStore().error('Cannot change status', failure)
    else error.value = failure instanceof Error ? failure.message : String(failure)
  }
}

// Accepting keeps the status comment: it carries the verification evidence.
const accept = () => {
  if (selected.value?.idea.status.state === 'review') void setStatus('implemented', selected.value.idea.status.comment)
}
const confirmSendBack = async () => {
  const reason = sendBackReason.value?.trim()
  if (!reason) return
  await setStatus('open', reason)
  sendBackReason.value = null
}
const startSendBack = async () => {
  if (!selected.value) return
  sendBackReason.value = ''
  await nextTick()
  reasonInput.value?.focus()
}
const open = () => {
  if (selected.value) modalStore.openIdeaEditModal(selected.value.idea.id)
}

// Capture phase: the inbox owns the keyboard unless an idea is open on top of it.
const handleKeydown = (event: KeyboardEvent) => {
  if (modalStore.showIdeaEditModal) return
  event.stopPropagation()
  if (sendBackReason.value !== null) {
    // Typing the reason: Enter submits the form, Escape abandons it.
    if (event.key === 'Escape') {
      event.preventDefault()
      sendBackReason.value = null
    }
    return
  }
  const actions: Record<string, () => void> = {
    j: () => { selectedIndex.value = Math.min(selectedIndex.value + 1, entries.value.length - 1) },
    ArrowDown: () => { selectedIndex.value = Math.min(selectedIndex.value + 1, entries.value.length - 1) },
    k: () => { selectedIndex.value = Math.max(selectedIndex.value - 1, 0) },
    ArrowUp: () => { selectedIndex.value = Math.max(selectedIndex.value - 1, 0) },
    o: open,
    e: open,
    Enter: open,
    a: accept,
    s: startSendBack,
    Escape: () => emit('close')
  }
  const action = actions[event.key]
  if (!action) return
  event.preventDefault()
  action()
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))
</script>

<template>
  <FormModalShell
    :show="true"
    title="Awaiting you"
    width="min(90vw, 48rem)"
    :close-on-escape="false"
    @request-close="emit('close')"
  >
    <div id="review-inbox">
      <div class="filters">
        <button
          v-for="state in AWAITING_HUMAN_STATES"
          :key="state"
          :class="{ active: shownStates.includes(state) }"
          @click="toggleState(state)"
        >{{ state }} {{ countOf(state) }}</button>
        <span class="order">
          <button
            v-for="option in ORDERS"
            :key="option"
            :class="{ active: order === option }"
            @click="order = option"
          >{{ option }}</button>
        </span>
      </div>

      <p v-if="entries.length === 0" class="empty">Nothing is waiting on you.</p>
      <ol v-else ref="listRef">
        <li
          v-for="(entry, index) in entries"
          :key="entry.idea.id"
          :class="{ selected: index === selectedIndex }"
          @click="selectedIndex = index"
          @dblclick="open"
        >
          <span class="priority">{{ formatIdeaPriority(entry.priority) }}</span>
          <span class="state" :style="{ color: statusColor(entry.idea.status.state) }">{{ entry.idea.status.state }}</span>
          <span class="copy">
            <span class="text">{{ entry.idea.text || '(untitled)' }}</span>
            <span v-if="entry.idea.status.comment" class="comment">{{ entry.idea.status.comment }}</span>
            <span v-if="index === selectedIndex && entry.idea.reflection" class="evidence">{{ entry.idea.reflection }}</span>
          </span>
        </li>
      </ol>

      <form v-if="sendBackReason !== null" class="send-back" @submit.prevent="confirmSendBack">
        <input ref="reasonInput" v-model="sendBackReason" placeholder="What still needs to change?" />
        <button type="submit" :disabled="!sendBackReason.trim()">Send back</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="keys">
        <span><kbd>j</kbd>/<kbd>k</kbd> move</span>
        <span><kbd>e</kbd>/<kbd>o</kbd> open</span>
        <span :class="{ unavailable: selected?.idea.status.state !== 'review' }"><kbd>a</kbd> accept</span>
        <span><kbd>s</kbd> send back</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  </FormModalShell>
</template>

<style scoped>
#review-inbox {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  & .filters {
    display: flex;
    gap: 0.4rem;

    & button {
      color: inherit;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 0.2rem 0.6rem;
      cursor: pointer;

      &.active { border-color: #007acc; background: #333; }
    }

    & .order { display: flex; gap: 0.4rem; margin-left: auto; }
  }

  & ol {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 60vh;
    overflow-y: auto;

    & li {
      display: grid;
      grid-template-columns: 4rem 10rem 1fr;
      gap: 0.5rem;
      padding: 0.4rem 0.5rem;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;

      &.selected { border-color: #888; background: #333; }
    }

    & .priority { font-family: monospace; color: #aaa; }
    & .copy { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
    & .comment, & .evidence { font-size: var(--font-size-small); color: #aaa; }
    & li:not(.selected) .comment { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    & .evidence { white-space: pre-wrap; }
  }

  & .send-back {
    display: flex;
    gap: 0.4rem;

    & input { flex: 1; }
  }

  & .empty, & .error { margin: 0; }
  & .error { color: #e57373; }

  & .keys {
    display: flex;
    gap: 1rem;
    font-size: var(--font-size-small);
    color: #aaa;

    & .unavailable { opacity: 0.4; }
    & kbd { font-family: monospace; }
  }
}
</style>
