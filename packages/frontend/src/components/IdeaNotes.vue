<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { trpc } from '../trpc'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast'
import { useViewerStore } from '../stores/viewer'
import { formatRelativeTime } from '../utils/relative-time'
import { hasAccounts } from '../utils/runtime-config'

// What visitors leave on an idea of a graph they cannot change: a note (an
// idea, a question) or "I'd like to work on this". Kept on the server, not in
// the graph; its owner and writers read them and may remove them.
const props = defineProps<{ ideaId: string }>()

const accounts = hasAccounts()
const projectStore = useProjectStore()
const viewer = useViewerStore()
type Listing = Awaited<ReturnType<typeof trpc.notes.list.query>>
const notes = ref<Listing['notes']>([])
const mayAdd = ref(false)
const text = ref('')

const load = async () => {
  if (!accounts) return
  try {
    const listing = await trpc.notes.list.query({ projectPath: projectStore.projectPath, ideaId: props.ideaId })
    notes.value = listing.notes
    mayAdd.value = listing.mayAdd
  } catch (error) {
    useToastStore().error('Could not load the notes', error)
  }
}
// Also when the viewer logs in or out: what they may do changes.
watch(() => [props.ideaId, viewer.name], () => { void load() }, { immediate: true })

const add = async (kind: 'note' | 'interest') => {
  // Where the server gives accounts automatically, the visitor gets theirs now.
  if (!await viewer.ensureAccount()) return
  try {
    notes.value.push(await trpc.notes.add.mutate({ projectPath: projectStore.projectPath, ideaId: props.ideaId, kind, text: text.value }))
    text.value = ''
  } catch (error) {
    useToastStore().error('Could not add the note', error)
  }
}

const remove = async (id: string) => {
  try {
    await trpc.notes.remove.mutate({ projectPath: projectStore.projectPath, id })
    notes.value = notes.value.filter(note => note.id !== id)
  } catch (error) {
    useToastStore().error('Could not remove the note', error)
  }
}
</script>

<template>
  <div v-if="accounts" class="idea-notes">
    <h4>Notes from visitors</h4>
    <div v-for="note in notes" :key="note.id" class="note">
      <span class="by">{{ note.author }} · {{ formatRelativeTime(Date.parse(note.createdAt)) }}</span>
      <button v-if="note.removable" class="remove" title="Remove this note" @click="remove(note.id)"><X /></button>
      <p><em v-if="note.kind === 'interest'">would like to work on this</em> {{ note.text }}</p>
    </div>
    <p v-if="notes.length === 0" class="by">None yet.</p>
    <form v-if="mayAdd" @submit.prevent="add('note')">
      <textarea v-model="text" rows="2" placeholder="An idea or a question for the people who write this graph" @keydown.stop></textarea>
      <div class="actions">
        <button class="btn-secondary" type="submit" :disabled="!text.trim()">Add note</button>
        <button class="btn-secondary" type="button" @click="add('interest')">I'd like to work on this</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.idea-notes {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  h4, p {
    margin: 0;
  }

  .note {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 0.5rem;

    p {
      grid-column: 1 / -1;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  }

  .by {
    color: #888;
  }

  .remove {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0;
  }

  form, .actions {
    display: flex;
    gap: 0.5rem;
  }

  form {
    flex-direction: column;
  }
}
</style>
