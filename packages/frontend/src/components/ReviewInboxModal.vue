<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import FormModalShell from './FormModalShell.vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { AWAITING_HUMAN_STATES, firstAppearanceOrder, rankIdeasAwaitingHuman, sortChronologically } from '../utils/review-inbox'
import { decide, decisionOptions, type DecisionOption, type StatusChange } from '../utils/decision-options'
import { linkParts } from '../utils/link-parts'
import { formatIdeaPriority } from '../utils/phase-priority'
import { isReadOnlyError } from '../utils/read-only'
import { useToastStore } from '../stores/toast'
import type { IdeaState } from 'shared'

// Everything that waits on the human, one card at a time: a number key picks
// an option and the next idea comes up. The list view shows them all at once.
const emit = defineEmits<{ close: [] }>()

const dataStore = useDataStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()

const shownStates = ref<string[]>([...AWAITING_HUMAN_STATES])
// Chronological: in the order the ideas first appear in the phases.
const ORDERS = ['priority', 'chronological'] as const
const order = ref<(typeof ORDERS)[number]>('priority')
const ORDER_LABELS = { priority: 'by priority', chronological: 'by plan' } as const
const ORDER_TITLES = { priority: 'Highest calculated priority first', chronological: 'In the order the ideas first appear in the phases' } as const
const VIEWS = ['cards', 'list'] as const
const view = ref<(typeof VIEWS)[number]>('cards')
const selectedIndex = ref(0)
// Past the last card: everything was decided or put off for later.
const finished = ref(false)
// The option waiting for its text (an answer, what to change), and that text.
const replying = ref<DecisionOption | null>(null)
const replyText = ref('')
const error = ref('')
const listRef = ref<HTMLElement | null>(null)
const replyInput = ref<HTMLTextAreaElement | null>(null)
// Each decision's statuses before it, newest last: u takes one back.
const undoStack = ref<StatusChange[][]>([])

const allEntries = computed(() => rankIdeasAwaitingHuman(dataStore.ideas, dataStore.calculatedPriorities))
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
const selected = computed(() => finished.value ? null : entries.value[selectedIndex.value] ?? null)
const options = computed(() => selected.value ? decisionOptions(selected.value.idea, dataStore.ideas) : [])
const parents = computed(() => (selected.value?.idea.supportedIdeas ?? [])
  .map(id => dataStore.ideas[id]?.text)
  .filter((text): text is string => !!text))
const statusColor = (state: string) => dataStore.getStatuses.find((status: IdeaState) => status.key === state)?.color ?? '#888'

// A decided idea leaves the list, so the same position shows the next one.
watch(entries, list => {
  if (selectedIndex.value < list.length) return
  if (view.value === 'cards' && list.length) finished.value = true
  selectedIndex.value = Math.max(list.length - 1, 0)
})
watch([shownStates, order], () => { selectedIndex.value = 0; finished.value = false })
watch(selectedIndex, async () => {
  await nextTick()
  listRef.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
})

const apply = async (changes: StatusChange[]) => {
  error.value = ''
  const before = changes.map(change => ({ ideaId: change.ideaId, status: dataStore.ideas[change.ideaId]!.status }))
  try {
    for (const change of changes) await dataStore.updateIdea(projectStore.projectPath, change.ideaId, { status: change.status })
    return before
  } catch (failure) {
    if (isReadOnlyError(failure)) useToastStore().error('Cannot change status', failure)
    else error.value = failure instanceof Error ? failure.message : String(failure)
    return null
  }
}

const choose = async (option: DecisionOption | undefined) => {
  const idea = selected.value?.idea
  if (!idea || !option) return
  if (option.kind === 'reply' && replying.value !== option) {
    replying.value = option
    replyText.value = ''
    await nextTick()
    replyInput.value?.focus()
    return
  }
  const before = await apply(decide(idea, option, dataStore.ideas, replyText.value))
  if (!before) return
  undoStack.value.push(before)
  replying.value = null
}
const submitReply = () => {
  if (replyText.value.trim()) void choose(replying.value ?? undefined)
}

const undo = async () => {
  const before = undoStack.value.pop()
  if (!before || !(await apply(before))) return
  await nextTick()
  const index = entries.value.findIndex(entry => entry.idea.id === before[0]!.ideaId)
  if (index >= 0) selectedIndex.value = index
  finished.value = false
}

const later = () => {
  if (selectedIndex.value + 1 < entries.value.length) selectedIndex.value++
  else if (view.value === 'cards') finished.value = true
}
const previous = () => {
  if (finished.value) finished.value = false
  else selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
}
const startOver = () => {
  selectedIndex.value = 0
  finished.value = false
}
const toggleView = () => {
  view.value = view.value === 'cards' ? 'list' : 'cards'
  finished.value = false
}
const showCard = (index: number) => {
  selectedIndex.value = index
  view.value = 'cards'
}
const edit = () => {
  if (selected.value) modalStore.openIdeaEditModal(selected.value.idea.id)
}

// Capture phase: the inbox owns the keyboard unless an idea is open on top of it.
const handleKeydown = (event: KeyboardEvent) => {
  if (modalStore.showIdeaEditModal) return
  event.stopPropagation()
  if (replying.value) {
    // Typing: Enter sends (Shift+Enter is a new line), Escape abandons it.
    if (event.key === 'Escape') {
      event.preventDefault()
      replying.value = null
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitReply()
    }
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (view.value === 'cards' && /^[1-9]$/.test(event.key)) {
    event.preventDefault()
    if (finished.value) startOver()
    else void choose(options.value[Number(event.key) - 1])
    return
  }
  const cards: Record<string, () => void> = {
    ' ': () => finished.value ? startOver() : later(),
    ArrowRight: later,
    l: later,
    ArrowLeft: previous,
    h: previous
  }
  const list: Record<string, () => void> = {
    j: later,
    ArrowDown: later,
    k: previous,
    ArrowUp: previous,
    Enter: () => showCard(selectedIndex.value)
  }
  const actions: Record<string, () => void> = {
    ...(view.value === 'cards' ? cards : list),
    e: edit,
    u: () => void undo(),
    Tab: toggleView,
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
    width="min(92vw, 48rem)"
    :close-on-escape="false"
    @request-close="emit('close')"
  >
    <div id="review-inbox">
      <div class="filters">
        <div class="states" role="group" aria-label="Show">
          <button
            v-for="state in AWAITING_HUMAN_STATES"
            :key="state"
            class="chip"
            :class="{ on: shownStates.includes(state) }"
            :aria-pressed="shownStates.includes(state)"
            :title="shownStates.includes(state) ? `Hide ${state}` : `Show ${state}`"
            @click="toggleState(state)"
          ><span class="dot" :style="{ background: statusColor(state) }" />{{ state }} <span class="count">{{ countOf(state) }}</span></button>
        </div>
        <div class="settings">
          <span class="segmented" role="group" aria-label="Order">
            <button
              v-for="option in ORDERS"
              :key="option"
              :class="{ on: order === option }"
              :aria-pressed="order === option"
              :title="ORDER_TITLES[option]"
              @click="order = option"
            >{{ ORDER_LABELS[option] }}</button>
          </span>
          <span class="segmented" role="group" aria-label="View (Tab)">
            <button
              v-for="option in VIEWS"
              :key="option"
              :class="{ on: view === option }"
              :aria-pressed="view === option"
              title="Cards or list (Tab)"
              @click="view !== option && toggleView()"
            >{{ option }}</button>
          </span>
        </div>
      </div>

      <p v-if="entries.length === 0" class="empty">Nothing is waiting on you.</p>

      <template v-else-if="view === 'cards'">
        <div v-if="finished" class="card finished">
          <p>That was all {{ entries.length }} still waiting.</p>
          <button @click="startOver">Start over <kbd>Space</kbd></button>
        </div>
        <div v-else-if="selected" class="card">
          <div class="card-body">
            <div class="card-meta">
              <span class="state" :style="{ color: statusColor(selected.idea.status.state) }">{{ selected.idea.status.state }}</span>
              <span class="priority">priority {{ formatIdeaPriority(selected.priority) }}</span>
              <span class="position">{{ selectedIndex + 1 }} / {{ entries.length }}</span>
            </div>
            <p v-if="parents.length" class="parents">for {{ parents.join(' · ') }}</p>
            <h3 @dblclick="edit">{{ selected.idea.text || '(untitled)' }}</h3>
            <p v-if="selected.idea.status.comment" class="comment"><template v-for="(part, index) in linkParts(selected.idea.status.comment)" :key="index"><a v-if="part.href" :href="part.href" target="_blank" rel="noopener">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></p>
            <details v-if="selected.idea.description">
              <summary>Description</summary>
              <p class="description"><template v-for="(part, index) in linkParts(selected.idea.description)" :key="index"><a v-if="part.href" :href="part.href" target="_blank" rel="noopener">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></p>
            </details>
          </div>

          <div class="card-actions">
            <ol class="options">
              <li v-for="(option, index) in options" :key="index" :class="[option.kind, { active: replying === option }]">
                <button @click="choose(option)"><kbd>{{ index + 1 }}</kbd> {{ option.label }}</button>
              </li>
            </ol>
            <form v-if="replying" class="reply" @submit.prevent="submitReply">
              <textarea ref="replyInput" v-model="replyText" rows="3" :placeholder="replying.kind === 'reply' ? replying.placeholder : ''" />
              <button type="submit" :disabled="!replyText.trim()">Send <kbd>Enter</kbd></button>
            </form>
          </div>
        </div>
      </template>

      <ol v-else ref="listRef" class="list">
        <li
          v-for="(entry, index) in entries"
          :key="entry.idea.id"
          :class="{ selected: index === selectedIndex }"
          @click="selectedIndex = index"
          @dblclick="showCard(index)"
        >
          <span class="priority">{{ formatIdeaPriority(entry.priority) }}</span>
          <span class="state" :style="{ color: statusColor(entry.idea.status.state) }">{{ entry.idea.status.state }}</span>
          <span class="copy">
            <span class="text">{{ entry.idea.text || '(untitled)' }}</span>
            <span v-if="entry.idea.status.comment" class="comment">{{ entry.idea.status.comment }}</span>
          </span>
        </li>
      </ol>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="keys">
        <template v-if="view === 'cards'">
          <span><kbd>1</kbd>–<kbd>9</kbd> decide</span>
          <span><kbd>Space</kbd>/<kbd>→</kbd> later</span>
          <span><kbd>←</kbd> back</span>
        </template>
        <template v-else>
          <span><kbd>j</kbd>/<kbd>k</kbd> move</span>
          <span><kbd>Enter</kbd> decide</span>
        </template>
        <span><kbd>e</kbd> edit</span>
        <span :class="{ unavailable: !undoStack.length }"><kbd>u</kbd> undo</span>
        <span><kbd>Tab</kbd> {{ view === 'cards' ? 'list' : 'cards' }}</span>
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

  & button {
    color: inherit;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }

  & .filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;

    & .states, & .settings { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    & button { white-space: nowrap; }

    /* States: independent toggles; an off state is dimmed with a hollow dot. */
    & .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      border-radius: 999px;
      opacity: 0.45;

      & .dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; }
      & .count { color: #aaa; }
      &.on { opacity: 1; background: #333; border-color: #666; }
      &:not(.on) .dot { background: transparent !important; box-shadow: inset 0 0 0 1px #888; }
    }

    /* Order and view: one of each, as joined buttons. */
    & .segmented {
      display: inline-flex;

      & button {
        border-radius: 0;
        color: #aaa;

        &:first-child { border-radius: 4px 0 0 4px; }
        &:last-child { border-radius: 0 4px 4px 0; }
        & + button { border-left: none; }
        &.on { color: inherit; background: #3a3a3a; }
      }
    }
  }

  /* The options stay at the bottom: the idea above scrolls, and the options
     scroll too once they would take more than half the card. */
  & .card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    height: min(65vh, 40rem);

    & .card-body, & .card-actions {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      min-height: 0;
      overflow-y: auto;
    }
    & .card-body { flex: 1 1 auto; }
    & .card-actions { flex: 0 0 auto; max-height: 50%; }

    & .card-meta {
      display: flex;
      gap: 1rem;
      font-size: var(--font-size-small);
      color: #aaa;

      & .position { margin-left: auto; }
    }

    & h3 { margin: 0; font-size: var(--font-size-title); }
    & .parents { margin: 0; font-size: var(--font-size-small); color: #aaa; }
    & .comment, & .description { margin: 0; white-space: pre-wrap; }
    & details { color: #ccc; }
    & summary { cursor: pointer; color: #aaa; }

    &.finished { align-items: center; justify-content: center; }
  }

  & .options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;

    & button {
      width: 100%;
      text-align: left;
      padding: 0.4rem 0.6rem;

      &:hover { border-color: #888; }
    }

    & .choose button { border-color: #c4a7e7; }
    & .active button { border-color: #007acc; }
  }

  & .reply {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;

    & textarea { flex: 1; }
  }

  & .list {
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
    & .comment { font-size: var(--font-size-small); color: #aaa; white-space: pre-wrap; }
    & li:not(.selected) .comment { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  }

  & .empty, & .error { margin: 0; }
  & .error { color: #e57373; }

  & .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    font-size: var(--font-size-small);
    color: #aaa;

    & .unavailable { opacity: 0.4; }
  }

  & kbd { font-family: monospace; }
}
</style>
