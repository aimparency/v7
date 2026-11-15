<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy } from 'lucide-vue-next'
import { useToastStore } from '../stores/toast'

// How to add this server to a coding agent, one command per agent. `login`:
// the address lets the agent log in by itself (OAuth); otherwise it carries a token.
const props = defineProps<{ url: string, login: boolean }>()

type Agent = { id: string, name: string, command: string, note: string }

const agents = computed<Agent[]>(() => [
  {
    id: 'claude', name: 'Claude Code',
    command: `claude mcp add --transport sse aimparency "${props.url}"`,
    note: props.login ? 'Then /mcp in Claude Code: it opens this server in the browser to log in.' : ''
  },
  {
    id: 'codex', name: 'Codex',
    // Codex reaches remote servers only over streamable HTTP; mcp-remote bridges to SSE.
    command: `codex mcp add aimparency -- npx -y mcp-remote "${props.url}"`,
    note: `Codex speaks only streamable HTTP to remote servers, so mcp-remote (Node) bridges.${props.login ? ' It opens this server in the browser to log in.' : ''}`
  },
  {
    id: 'gemini', name: 'Gemini CLI',
    command: `gemini mcp add --transport sse aimparency "${props.url}"`,
    note: props.login ? 'Then /mcp auth aimparency in Gemini CLI to log in.' : ''
  },
  {
    id: 'other', name: 'Other',
    command: JSON.stringify({ mcpServers: { aimparency: { type: 'sse', url: props.url } } }, null, 2),
    note: 'For clients configured with an mcpServers JSON (Cursor, Claude Desktop through mcp-remote, …).'
  }
])

const selected = ref('claude')
const agent = computed(() => agents.value.find(candidate => candidate.id === selected.value)!)

const copy = async () => {
  try {
    await navigator.clipboard.writeText(agent.value.command)
    useToastStore().info(`Copied the command for ${agent.value.name}.`)
  } catch (error) {
    useToastStore().error('Could not copy', error)
  }
}
</script>

<template>
  <div class="agent-commands stack">
    <div class="tabs" role="tablist">
      <button
        v-for="candidate in agents"
        :key="candidate.id"
        type="button"
        role="tab"
        class="view-btn"
        :class="{ active: candidate.id === selected }"
        :aria-selected="candidate.id === selected"
        @click="selected = candidate.id"
      >{{ candidate.name }}</button>
    </div>
    <div class="command">
      <pre class="copyable">{{ agent.command }}</pre>
      <button type="button" class="icon-btn copy" title="Copy" @click="copy"><Copy /></button>
    </div>
    <p v-if="agent.note" class="hint">{{ agent.note }}</p>
  </div>
</template>

<style scoped>
.agent-commands {
  gap: var(--gap-s);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  align-self: flex-start;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;

  .view-btn {
    height: var(--control-h);
    outline: none;
  }
}

.command {
  display: flex;
  gap: var(--gap-s);
  align-items: flex-start;

  pre {
    flex: 1;
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
  }
}
</style>
