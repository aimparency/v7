<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { gitRepositoryLocation } from 'shared'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'

// A space from a private repository: the server makes an SSH key (only its
// public half leaves the server), its owner adds that as a deploy key of the
// repository with write access, and the server clones with it. A repository
// without a .bowman gets a new space, committed and pushed there.
const props = defineProps<{ url: string }>()
const emit = defineEmits<{ close: [], added: [slug: string, pushError: string | null] }>()

const keys = ref<Awaited<ReturnType<typeof trpc.keys.list.query>>>([])
const keyId = ref('')
const error = ref('')
const busy = ref(false)
const copied = ref(false)

const location = computed(() => gitRepositoryLocation(props.url))
const repositoryName = computed(() => location.value?.slice(1).join('/') ?? props.url)
// Where GitHub takes a new deploy key for this very repository.
const deployKeyPage = computed(() => {
  const [host, owner, repository] = location.value ?? []
  return host === 'github.com' && owner && repository ? `https://github.com/${owner}/${repository}/settings/keys/new` : null
})
const selected = computed(() => keys.value.find(key => key.id === keyId.value) ?? null)

const run = async (action: () => Promise<void>) => {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

onMounted(() => run(async () => {
  keys.value = await trpc.keys.list.query()
}))

const makeKey = () => run(async () => {
  const key = await trpc.keys.create.mutate({ label: `${repositoryName.value} on ${window.location.host}` })
  keys.value = [...keys.value, key]
  keyId.value = key.id
  copied.value = false
})

const copy = async () => {
  if (!selected.value) return
  copied.value = await navigator.clipboard.writeText(selected.value.publicKey).then(() => true, () => false)
}

const add = () => run(async () => {
  const { slug, pushError } = await trpc.spaces.addRemote.mutate({ url: props.url, key: keyId.value })
  emit('added', slug, pushError)
})
</script>

<template>
  <FormModalShell show title="Add a private repository" width="min(92vw, 38rem)" @request-close="emit('close')">
    <div class="stack">
      <p class="hint">
        <code>{{ repositoryName }}</code> is cloned over SSH with a key this server keeps. Add the key's public half to the repository as a deploy key
        <strong>with write access</strong>, so changes made here are pushed back. A repository without a <code>.bowman</code> gets a new, empty space.
      </p>

      <label class="stack field">
        <span>Key</span>
        <div class="row">
          <select v-model="keyId" :disabled="busy">
            <option value="" disabled>{{ keys.length ? 'Choose one of your keys…' : 'No keys yet' }}</option>
            <option v-for="key in keys" :key="key.id" :value="key.id">{{ key.label }}</option>
          </select>
          <button class="btn-secondary" type="button" :disabled="busy" @click="makeKey">Make a new key</button>
        </div>
      </label>

      <template v-if="selected">
        <textarea class="public-key" readonly rows="3" :value="selected.publicKey" @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
        <div class="row">
          <button class="btn-secondary" type="button" @click="copy">{{ copied ? 'Copied' : 'Copy public key' }}</button>
          <a v-if="deployKeyPage" :href="deployKeyPage" target="_blank" rel="noopener">Open the repository's deploy keys on GitHub</a>
        </div>
        <p class="hint">Once it is added there (tick "Allow write access"), add the space.</p>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-primary" type="button" :disabled="busy || !selected" @click="add">{{ busy ? 'Cloning…' : 'Add space' }}</button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.field {
  gap: var(--gap-s);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-s);
}
.row select {
  flex: 1;
  min-width: 12rem;
}
.public-key {
  width: 100%;
  font-family: monospace;
  font-size: var(--font-size-small);
  word-break: break-all;
  resize: none;
}
</style>
