<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import AgentCommands from './AgentCommands.vue'

// Connecting a coding agent without accounts: the agent starts Aimparency's
// MCP server itself, on this machine, and it talks to this backend.
const emit = defineEmits<{ close: [] }>()

type Command = Awaited<ReturnType<typeof trpc.system.mcpCommand.query>>
const command = ref<Command>(null)
const error = ref('')

onMounted(async () => {
  try {
    command.value = await trpc.system.mcpCommand.query()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
})
</script>

<template>
  <FormModalShell show title="Connect an agent (MCP)" width="min(94vw, 42rem)" @request-close="emit('close')">
    <div class="stack">
      <p class="hint">A coding agent (an MCP client) on this machine reads and changes your spaces: it adds ideas, links them and keeps their statuses up to date.</p>
      <AgentCommands v-if="command" :stdio="command" />
      <p class="hint">Run it once in a terminal. The agent starts the MCP server itself while this Aimparency is running.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </FormModalShell>
</template>
