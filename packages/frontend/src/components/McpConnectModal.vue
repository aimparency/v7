<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { trpc } from '../trpc'
import { formatRelativeTime } from '../utils/relative-time'
import { useViewerStore } from '../stores/viewer'
import FormModalShell from './FormModalShell.vue'
import GraphScopeChoice from './GraphScopeChoice.vue'
import AgentCommands from './AgentCommands.vue'

// Connecting an MCP client (a coding agent) to this server: it acts as this
// account, on all its graphs or only on the ones chosen here. The link carries
// the login, so it is shown once and handled like a password.
const emit = defineEmits<{ close: [] }>()

// With a public address an agent logs in by itself: one command, then the
// person approves it in the browser and chooses its graphs there.
const viewer = useViewerStore()
const loginUrl = computed(() => viewer.publicUrl ? `${viewer.publicUrl}/mcp/login/sse` : null)
const showLinkForm = ref(false)

const tokens = ref<Awaited<ReturnType<typeof trpc.auth.listTokens.query>>>([])
const scope = ref<string[] | null>(null)
const label = ref('')
const link = ref('')
const error = ref('')

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
  tokens.value = await trpc.auth.listTokens.query()
})
onMounted(load)

const create = () => run(async () => {
  const graphs = scope.value ?? undefined
  const { token } = await trpc.auth.issueToken.mutate({ label: label.value.trim() || 'mcp', graphs })
  // One graph: its own address, where the client's tools need no graph name.
  const base = graphs?.length === 1 ? `${window.location.origin}/g/${graphs[0]}` : window.location.origin
  link.value = `${base}/mcp/sse?token=${token}`
  await load()
})

const revoke = (id: string) => run(async () => {
  await trpc.auth.revokeOwnToken.mutate({ id })
  await load()
})
</script>

<template>
  <FormModalShell show title="Connect an agent (MCP)" width="min(94vw, 42rem)" @request-close="emit('close')">
    <div class="stack">
      <p class="hint">A coding agent (an MCP client) acts as you on this server: it reads the spaces and changes the ones you may change.</p>

      <template v-if="loginUrl">
        <h4 class="section-title">Add it to your agent</h4>
        <AgentCommands :url="loginUrl" login />
        <p class="hint">On first use the agent opens this server in the browser: you log in, choose the spaces it may reach and approve.</p>
        <button v-if="!showLinkForm" type="button" class="btn-secondary link-toggle" @click="showLinkForm = true">Or make a link with a token instead</button>
      </template>

      <template v-if="!loginUrl || showLinkForm">
        <h4 class="section-title">{{ loginUrl ? 'A link with a token' : 'Make a link for your agent' }}</h4>
        <GraphScopeChoice v-model="scope" />
        <form class="row" @submit.prevent="create">
          <input v-model="label" placeholder="A name for this agent, e.g. the machine it runs on" />
          <button class="btn-primary" type="submit" :disabled="scope?.length === 0">Create link</button>
        </form>
        <template v-if="link">
          <p class="hint warning">The link contains a login: keep it private. It is shown only now.</p>
          <AgentCommands :url="link" :login="false" />
        </template>
        <p v-if="!loginUrl && viewer.serverAdmin" class="hint">With a public address in Server settings, agents log in by themselves and need no link.</p>
      </template>
      <p v-if="error" class="error">{{ error }}</p>

      <template v-if="clients.length > 0">
        <h4 class="section-title">Connected agents</h4>
        <div v-for="token in clients" :key="token.id" class="row">
          <span class="grow">{{ token.label }} · {{ token.graphs ? token.graphs.join(', ') : 'all graphs' }} · {{ formatRelativeTime(Date.parse(token.createdAt)) }}</span>
          <button class="btn-secondary" @click="revoke(token.id)">Revoke</button>
        </div>
      </template>
    </div>
  </FormModalShell>
</template>

<style scoped>
.link-toggle {
  align-self: flex-start;
}
</style>
