<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MessageSquare } from 'lucide-vue-next'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import { formatRelativeTime } from '../utils/relative-time'
import FormModalShell from './FormModalShell.vue'

// Recent notes of other people on the spaces this account owns or writes: the
// number in the header counts those that came since the list was last opened.
const emit = defineEmits<{ open: [slug: string, ideaId: string] }>()

const SEEN_KEY = 'aimparency-notes-seen'
const REFRESH_MS = 2 * 60_000
const viewer = useViewerStore()
const notes = ref<Awaited<ReturnType<typeof trpc.notes.recent.query>>>([])
const seenUntil = ref(localStorage.getItem(SEEN_KEY) ?? '')
const show = ref(false)
const unseen = computed(() => notes.value.filter(note => note.createdAt > seenUntil.value).length)

const load = async () => {
  if (!viewer.name) {
    notes.value = []
    return
  }
  // The badge is a nicety: a failed refresh keeps what it showed.
  notes.value = await trpc.notes.recent.query().catch(() => notes.value)
}

const open = () => {
  show.value = true
  seenUntil.value = new Date().toISOString()
  localStorage.setItem(SEEN_KEY, seenUntil.value)
}

const openNote = (slug: string, ideaId: string) => {
  show.value = false
  emit('open', slug, ideaId)
}

watch(() => viewer.name, () => { void load() }, { immediate: true })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(load, REFRESH_MS)
  window.addEventListener('focus', load)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('focus', load)
})
</script>

<template>
  <button
    v-if="notes.length > 0"
    class="icon-btn inbox-btn"
    :class="{ unseen: unseen > 0 }"
    title="Notes visitors left on your spaces"
    @click="open"
  >
    <MessageSquare /> {{ unseen || '' }}
  </button>

  <FormModalShell :show="show" title="Notes on your spaces" width="min(90vw, 40rem)" @request-close="show = false">
    <div class="notes-inbox">
      <button v-for="note in notes" :key="note.id" class="entry" @click="openNote(note.slug, note.ideaId)">
        <span class="where">{{ note.slug }} · {{ note.ideaText }}</span>
        <span class="by">{{ note.author }} · {{ formatRelativeTime(Date.parse(note.createdAt)) }}</span>
        <span class="text">
          <em v-if="note.kind === 'interest'">would like to work on this</em>
          <em v-else-if="note.kind === 'offer'">offers the space {{ note.offeredSpace?.name }}{{ note.text ? ':' : '' }}</em>
          {{ note.text }}
        </span>
      </button>
    </div>
  </FormModalShell>
</template>

<style scoped>
.unseen {
  color: var(--status-unclear);
  border-color: var(--status-unclear);
}

.notes-inbox {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .entry {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 0.5rem;
    text-align: left;
    background: none;
    border: 1px solid #333;
    border-radius: 0.25rem;
    padding: 0.5rem;
    color: inherit;
    cursor: pointer;

    .by {
      color: #888;
    }

    .text {
      grid-column: 1 / -1;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  }
}
</style>
