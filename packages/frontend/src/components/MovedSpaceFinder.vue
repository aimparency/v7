<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { trpc } from '../trpc'
import type { SpaceIdentity } from '../stores/ui/project-helpers'

// A recent space whose folder is gone: it is looked for on this machine by its
// id (the same space, wherever it went), and by its folder name (only a guess,
// so it is offered, never taken). Or its new path is typed by hand. A space
// there with another id is used only after saying so.

type Found = Awaited<ReturnType<typeof trpc.project.discoverLocalProjects.query>>['projects'][number]

const props = defineProps<{ from: string, identity: SpaceIdentity }>()
const emit = defineEmits<{ (event: 'use', path: string, identity: SpaceIdentity): void }>()

const searching = ref(true)
const candidates = ref<Found[]>([])
const typed = ref('')
const problem = ref('')
const otherSpace = ref<Found | null>(null)

const folderName = props.from.replace(/\/+$/, '').split('/').pop() ?? ''
const use = (found: Found) => emit('use', found.path, { repoId: found.repoId, name: found.name })

onMounted(async () => {
  try {
    const { projects } = await trpc.project.discoverLocalProjects.query({
      maxDepth: 6, limit: 20, name: props.identity.name ?? folderName,
      ...(props.identity.repoId ? { repoId: props.identity.repoId } : {})
    })
    const same = projects.filter(found => found.matchedBy === 'id')
    if (same.length === 1) return use(same[0]!)
    candidates.value = projects
  } catch (error) {
    problem.value = `Could not search: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    searching.value = false
  }
})

const useTyped = async () => {
  problem.value = ''
  otherSpace.value = null
  const path = typed.value.trim()
  if (!path) return
  const { projects } = await trpc.project.discoverLocalProjects.query({ roots: [path], maxDepth: 0 })
  const found = projects[0]
  if (!found) {
    problem.value = `No space (.bowman) at ${path}.`
    return
  }
  if (props.identity.repoId && found.repoId !== props.identity.repoId) otherSpace.value = found
  else use(found)
}
</script>

<template>
  <div class="moved-space-finder">
    <p v-if="searching" class="note">Looking for it on this machine…</p>
    <template v-else>
      <p class="note">{{ candidates.length ? 'Found:' : 'Not found nearby or in your home folder.' }}</p>
      <ul v-if="candidates.length" class="candidates">
        <li v-for="found in candidates" :key="found.path">
          <button type="button" @click="use(found)">{{ found.path }}</button>
          <span class="note">{{ found.matchedBy === 'id' ? 'the same space' : 'same name, maybe another space' }}</span>
        </li>
      </ul>
    </template>
    <form class="typed" @submit.prevent="useTyped">
      <input v-model="typed" placeholder="Its new path" aria-label="Its new path" />
      <button type="submit" :disabled="!typed.trim()">Use</button>
    </form>
    <p v-if="problem" class="problem">{{ problem }}</p>
    <p v-if="otherSpace" class="problem">
      That is another space ({{ otherSpace.name ?? otherSpace.path }}).
      <button type="button" @click="use(otherSpace)">Use it anyway</button>
    </p>
  </div>
</template>

<style scoped>
.moved-space-finder {
  display: flex;
  flex-direction: column;
  gap: var(--gap-s);
  padding: var(--gap-s) var(--gap-m) var(--gap-m) 3.5rem;

  & .note {
    margin: 0;
    color: var(--text-muted);
  }

  & .candidates {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap-s);

    & li {
      display: flex;
      gap: var(--gap-s);
      align-items: baseline;
    }
  }

  & .typed {
    display: flex;
    gap: var(--gap-s);

    & input {
      flex: 1;
    }
  }

  & .problem {
    margin: 0;
    color: var(--error);
  }
}
</style>
