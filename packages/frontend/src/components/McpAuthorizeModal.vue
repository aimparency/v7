<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Copy } from 'lucide-vue-next'
import { useToastStore } from '../stores/toast'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import FormModalShell from './FormModalShell.vue'
import SpaceScopeChoice from './SpaceScopeChoice.vue'
import LoginControl from './LoginControl.vue'

// An MCP client asked for a login by itself and sent the person here
// (?mcp-authorize=<request>): they see who asks, choose what it may reach,
// and approve or refuse. Either way the browser goes back to the client.
const props = defineProps<{ requestId: string }>()
const emit = defineEmits<{ close: [] }>()

const viewer = useViewerStore()
const request = ref<Awaited<ReturnType<typeof trpc.mcpAuth.pending.query>>>(null)
const loaded = ref(false)
const scope = ref<string[] | null>(null)
const error = ref('')

onMounted(async () => {
  request.value = await trpc.mcpAuth.pending.query({ requestId: props.requestId }).catch(() => null)
  loaded.value = true
})

// An agent on the person's own computer listens on localhost for the answer.
// One on another machine (a server, over SSH) does not: the browser would
// land on nothing. So for a localhost answer the address is shown to copy back
// to the agent, with a button for an agent that does run on this computer.
const returnAddress = ref('')
const isLoopback = (url: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

const answer = async (decide: () => Promise<{ redirectTo: string }>) => {
  error.value = ''
  try {
    const { redirectTo } = await decide()
    if (isLoopback(redirectTo)) returnAddress.value = redirectTo
    else window.location.href = redirectTo
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const approve = () => answer(async () => {
  // Where the server gives accounts automatically, the visitor gets theirs now.
  if (!await viewer.ensureAccount()) throw new Error('Log in first.')
  return trpc.mcpAuth.approve.mutate({ requestId: props.requestId, spaces: scope.value ?? undefined })
})
const deny = () => answer(() => trpc.mcpAuth.deny.mutate({ requestId: props.requestId }))

const copyReturnAddress = async () => {
  try {
    await navigator.clipboard.writeText(returnAddress.value)
    useToastStore().info('Copied. Give it to your agent.')
  } catch (caught) {
    useToastStore().error('Could not copy', caught)
  }
}
const continueHere = () => { window.location.href = returnAddress.value }
</script>

<template>
  <FormModalShell show title="Connect an agent (MCP)" width="min(92vw, 34rem)" @request-close="emit('close')">
    <div class="stack">
      <template v-if="returnAddress">
        <p>Done. Now the answer goes back to the agent.</p>
        <p class="hint">If the agent runs on another computer (a server, over SSH), copy this address and give it to the agent, for example paste it into its chat:</p>
        <div class="return-address">
          <code class="copyable">{{ returnAddress }}</code>
          <button type="button" class="icon-btn" title="Copy" @click="copyReturnAddress"><Copy /></button>
        </div>
        <p class="hint">If it runs on this computer, continue in this browser.</p>
      </template>
      <p v-else-if="loaded && !request">This request is not waiting any more. Start again from the agent.</p>
      <template v-else-if="request">
        <p><strong>{{ request.clientName }}</strong> asks to act as you on this server. The answer goes to <code>{{ request.redirectHost }}</code>.</p>
        <template v-if="viewer.name || viewer.getsAccountAutomatically">
          <p v-if="viewer.name" class="hint">You are {{ viewer.name }}. Choose what it may reach.</p>
          <SpaceScopeChoice v-model="scope" />
        </template>
        <template v-else>
          <p class="hint">Log in first, so it is clear whom it acts as.</p>
          <LoginControl />
        </template>
        <p v-if="error" class="error">{{ error }}</p>
      </template>
      <p v-else class="hint">Loading the request…</p>
    </div>
    <template v-if="returnAddress" #footer>
      <button class="btn-secondary" @click="emit('close')">Close</button>
      <button class="btn-primary" @click="continueHere">Continue in this browser</button>
    </template>
    <template v-else-if="request" #footer>
      <button class="btn-secondary" @click="deny">Refuse</button>
      <button class="btn-primary" :disabled="!(viewer.name || viewer.getsAccountAutomatically) || scope?.length === 0" @click="approve">Approve</button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.return-address {
  display: flex;
  gap: var(--gap-s);
  align-items: flex-start;

  code {
    flex: 1;
  }
}
</style>
