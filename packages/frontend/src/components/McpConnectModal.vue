<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { trpc } from '../trpc'
import { formatRelativeTime } from '../utils/relative-time'
import FormModalShell from './FormModalShell.vue'

// Connecting an MCP client (a coding agent) to this server: it acts as this
// account, on all its graphs or only on the ones chosen here. The link carries
// the login, so it is shown once and handled like a password.
const emit = defineEmits<{ close: [] }>()

type Graph = Awaited<ReturnType<typeof trpc.graphs.list.query>>[number]
const graphs = ref<Graph[]>([])
const tokens = ref<Awaited<ReturnType<typeof trpc.auth.listTokens.query>>>([])
const everywhere = ref(true)
const chosen = ref<string[]>([])
const label = ref('')
const link = ref('')
const error = ref('')

const mine = computed(() => graphs.value.filter(graph => graph.right !== 'read'))
// The browsers this account is logged in at are logins too, but not what this dialog is about.
const clients = computed(() => tokens.value.filter(token => token.label !== 'browser'))

const run = async (action: () => Promise<void>) => {
  error.value = ''
  try {
    await action()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const load = () => run(async () => {
  [graphs.value, tokens.value] = await Promise.all([trpc.graphs.list.query(), trpc.auth.listTokens.query()])
})
onMounted(load)

const create = () => run(async () => {
  const scope = everywhere.value ? undefined : chosen.value
  const { token } = await trpc.auth.issueToken.mutate({ label: label.value.trim() || 'mcp', graphs: scope })
  // One graph: its own address, where the client's tools need no graph name.
  const base = scope?.length === 1 ? `${window.location.origin}/g/${scope[0]}` : window.location.origin
  link.value = `${base}/mcp/sse?token=${token}`
  await load()
})

const revoke = (id: string) => run(async () => {
  await trpc.auth.revokeOwnToken.mutate({ id })
  await load()
})
</script>

<template>
  <FormModalShell show title="Connect an MCP client" width="min(90vw, 40rem)" @request-close="emit('close')">
    <div class="mcp-connect">
      <p class="hint">An MCP client, such as a coding agent, acts as you on this server. Choose what it may reach.</p>
      <label><input v-model="everywhere" type="radio" :value="true" /> all my graphs, also future ones</label>
      <label><input v-model="everywhere" type="radio" :value="false" /> only these graphs</label>
      <div v-if="!everywhere" class="graphs">
        <label v-for="graph in mine" :key="graph.slug"><input v-model="chosen" type="checkbox" :value="graph.slug" /> {{ graph.name }}</label>
        <p v-if="mine.length === 0" class="hint">You write no graph on this server yet.</p>
      </div>
      <form class="row" @submit.prevent="create">
        <input v-model="label" class="grow" placeholder="A name for this client, for example the machine it runs on" />
        <button class="btn-primary" type="submit" :disabled="!everywhere && chosen.length === 0">Create link</button>
      </form>
      <template v-if="link">
        <p class="hint">It acts as you: keep it private. It is shown only now.</p>
        <code>{{ link }}</code>
        <code>claude mcp add --transport sse aimparency "{{ link }}"</code>
      </template>
      <p v-if="error" class="error">{{ error }}</p>

      <h4 v-if="clients.length > 0">Connected clients</h4>
      <div v-for="token in clients" :key="token.id" class="row">
        <span class="grow">{{ token.label }} · {{ token.graphs ? token.graphs.join(', ') : 'all graphs' }} · {{ formatRelativeTime(Date.parse(token.createdAt)) }}</span>
        <button class="btn-secondary" @click="revoke(token.id)">Revoke</button>
      </div>
    </div>
  </FormModalShell>
</template>

<style scoped>
.mcp-connect {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .row {
    display: flex;
    gap: 0.375rem;
    align-items: center;

    .grow {
      flex: 1;
    }
  }

  .graphs {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-left: 1.5rem;
  }

  h4, .hint, .error {
    margin: 0;
  }

  .hint {
    color: #888;
  }

  .error {
    color: #e57373;
  }

  code {
    user-select: all;
    word-break: break-all;
  }
}
</style>
