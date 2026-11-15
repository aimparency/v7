<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchGraphAtHost } from 'shared'
import { trpc } from '../trpc'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast'
import { useViewerStore } from '../stores/viewer'
import FormModalShell from './FormModalShell.vue'

// Without write access to a space, what supports one of its ideas comes from
// a space of the visitor's own: a new one, one they have, or one on another
// server. They offer it with a pitch; the space's owner accepts the offer
// (the offered space then supports the idea) or declines it.
const props = defineProps<{ ideaId: string }>()
const emit = defineEmits<{ close: [] }>()

const viewer = useViewerStore()
const dataStore = useDataStore()
const projectStore = useProjectStore()
const toast = useToastStore()

const ideaText = computed(() => dataStore.ideas[props.ideaId]?.text ?? 'this idea')
type Source = 'new' | 'mine' | 'elsewhere'
const source = ref<Source>('new')
const name = ref('')
const address = ref('')
const pitch = ref('')
const busy = ref(false)
const error = ref('')

// The visitor's spaces on this server, but not the one they propose to.
type Listed = Awaited<ReturnType<typeof trpc.graphs.list.query>>[number]
const mine = ref<Listed[]>([])
const chosen = ref('')
onMounted(async () => {
  if (viewer.name === null) return
  const all = await trpc.graphs.list.query().catch(() => [] as Listed[])
  mine.value = all.filter(space => space.right !== 'read' && space.slug !== projectStore.projectPath)
  chosen.value = mine.value[0]?.slug ?? ''
})

const ready = computed(() => ({
  new: name.value.trim() !== '',
  mine: chosen.value !== '',
  elsewhere: address.value.trim() !== ''
})[source.value])

const here = (slug: string) => `${viewer.publicUrl ?? window.location.origin}/spaces/${slug}`

// The offered space as its own server describes it.
async function offeredSpace(): Promise<{ host: string; repoId: string; name: string }> {
  if (source.value === 'elsewhere') {
    const { host, repoId, name } = await fetchGraphAtHost(address.value)
    return { host, repoId, name }
  }
  const slug = source.value === 'new'
    ? (await trpc.graphs.create.mutate({ name: name.value.trim() })).slug
    : chosen.value
  const meta = await trpc.project.getMeta.query({ graph: slug })
  if (!meta.repoId) throw new Error(`Space "${slug}" has no identity yet.`)
  return { host: here(slug), repoId: meta.repoId, name: meta.name ?? slug }
}

async function offer() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // Where the server gives accounts automatically, the visitor gets theirs now.
    if (!await viewer.ensureAccount()) return
    const space = await offeredSpace()
    await trpc.notes.add.mutate({ graph: projectStore.projectPath, ideaId: props.ideaId, kind: 'offer', text: pitch.value, space })
    toast.info(`Offered ${space.name}: the owner of this space decides.`)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FormModalShell show title="Propose a space" width="min(94vw, 36rem)" @request-close="emit('close')" @confirm="offer">
    <form class="stack propose" @submit.prevent="offer">
      <p class="hint">
        You can't add to this space, but a space of your own can support “{{ ideaText }}”.
        Offer one: its owner sees the offer and decides whether to link it.
      </p>

      <label class="choice">
        <input v-model="source" type="radio" value="new" />
        <span>A new space on this server</span>
      </label>
      <input v-if="source === 'new'" v-model="name" class="indented" placeholder="Its name, e.g. what you will do for this idea" autofocus @keydown.stop />

      <label v-if="mine.length > 0" class="choice">
        <input v-model="source" type="radio" value="mine" />
        <span>One of your spaces</span>
      </label>
      <select v-if="source === 'mine'" v-model="chosen" class="indented">
        <option v-for="space in mine" :key="space.slug" :value="space.slug">{{ space.name }} ({{ space.slug }})</option>
      </select>

      <label class="choice">
        <input v-model="source" type="radio" value="elsewhere" />
        <span>A space on another server</span>
      </label>
      <input v-if="source === 'elsewhere'" v-model="address" class="indented" placeholder="https://<server>/spaces/<space>" @keydown.stop />

      <h4 class="section-title">Why it helps</h4>
      <textarea v-model="pitch" rows="3" :placeholder="`How your space moves “${ideaText}” forward`" @keydown.stop></textarea>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <span class="grow"></span>
        <button type="button" class="btn-secondary" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn-primary" :disabled="!ready || busy">{{ busy ? 'Offering…' : 'Offer' }}</button>
      </div>
    </form>
  </FormModalShell>
</template>

<style scoped>
.propose {
  .choice {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    cursor: pointer;
  }

  .indented {
    margin-left: 1.5rem;
  }

  textarea {
    resize: vertical;
  }
}
</style>
