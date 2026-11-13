<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import FormModalShell from './FormModalShell.vue'
import GraphScopeChoice from './GraphScopeChoice.vue'
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

const answer = async (decide: () => Promise<{ redirectTo: string }>) => {
  error.value = ''
  try {
    window.location.href = (await decide()).redirectTo
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const approve = () => answer(async () => {
  // Where the server gives accounts automatically, the visitor gets theirs now.
  if (!await viewer.ensureAccount()) throw new Error('Log in first.')
  return trpc.mcpAuth.approve.mutate({ requestId: props.requestId, graphs: scope.value ?? undefined })
})
const deny = () => answer(() => trpc.mcpAuth.deny.mutate({ requestId: props.requestId }))
</script>

<template>
  <FormModalShell show title="Connect an MCP client" width="min(90vw, 32rem)" @request-close="emit('close')">
    <div class="mcp-authorize">
      <p v-if="loaded && !request">This request is not waiting any more. Start again from the MCP client.</p>
      <template v-else-if="request">
        <p><strong>{{ request.clientName }}</strong> asks to act as you on this server. Your approval is sent to <code>{{ request.redirectHost }}</code>.</p>
        <template v-if="viewer.name || viewer.getsAccountAutomatically">
          <p v-if="viewer.name" class="hint">You are {{ viewer.name }}. Choose what it may reach.</p>
          <GraphScopeChoice v-model="scope" />
        </template>
        <template v-else>
          <p class="hint">Log in first, so it is clear whom it acts as.</p>
          <LoginControl />
        </template>
        <p v-if="error" class="error">{{ error }}</p>
      </template>
    </div>
    <template v-if="request" #footer>
      <button class="btn-secondary" @click="deny">Refuse</button>
      <button class="btn-primary" :disabled="!(viewer.name || viewer.getsAccountAutomatically) || scope?.length === 0" @click="approve">Approve</button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.mcp-authorize {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  p {
    margin: 0;
  }

  .hint {
    color: #888;
  }

  .error {
    color: #e57373;
  }
}
</style>
