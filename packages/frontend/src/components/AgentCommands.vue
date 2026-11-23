<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy } from 'lucide-vue-next'
import { useToastStore } from '../stores/toast'

// How to add this server to a coding agent, one command per agent: either an
// address (`login`: the agent logs in by itself, OAuth; otherwise the address
// carries a token) or, on a server without accounts, a command the agent
// starts itself (stdio).
type Stdio = { command: string, args: string[], env: Record<string, string> }
const props = defineProps<{ url?: string, login?: boolean, stdio?: Stdio }>()

type Agent = { id: string, name: string, command: string, note: string }

const quote = (word: string) => /^[\w/.:=@%+-]+$/.test(word) ? word : `'${word.split("'").join("'\\''")}'`
const line = (words: string[]) => words.map(quote).join(' ')

const stdioAgents = (stdio: Stdio): Agent[] => {
  const env = Object.entries(stdio.env).map(([key, value]) => `${key}=${value}`)
  const launch = [stdio.command, ...stdio.args]
  return [
    {
      id: 'claude', name: 'Claude Code',
      command: line(['claude', 'mcp', 'add', '--scope', 'user', ...env.flatMap(pair => ['-e', pair]), 'aimparency', '--', ...launch]),
      note: 'For all your projects; the tools name the space they work on.'
    },
    {
      id: 'codex', name: 'Codex',
      command: line(['codex', 'mcp', 'add', ...env.flatMap(pair => ['--env', pair]), 'aimparency', '--', ...launch]),
      note: ''
    },
    {
      id: 'gemini', name: 'Gemini CLI',
      command: line(['gemini', 'mcp', 'add', '--scope', 'user', ...env.flatMap(pair => ['-e', pair]), 'aimparency', ...launch]),
      note: ''
    },
    {
      id: 'other', name: 'Other',
      command: JSON.stringify({ mcpServers: { aimparency: { command: stdio.command, args: stdio.args, ...(env.length ? { env: stdio.env } : {}) } } }, null, 2),
      note: 'For clients configured with an mcpServers JSON (Cursor, Claude Desktop, …).'
    }
  ]
}

const urlAgents = (url: string, login: boolean): Agent[] => [
  {
    id: 'claude', name: 'Claude Code',
    command: `claude mcp add --transport sse aimparency "${url}"`,
    note: login ? 'Then /mcp in Claude Code: it opens this server in the browser to log in.' : ''
  },
  {
    id: 'codex', name: 'Codex',
    // Codex reaches remote servers only over streamable HTTP; mcp-remote bridges to SSE.
    command: `codex mcp add aimparency -- npx -y mcp-remote "${url}"`,
    note: `Codex speaks only streamable HTTP to remote servers, so mcp-remote (Node) bridges.${login ? ' It opens this server in the browser to log in.' : ''}`
  },
  {
    id: 'gemini', name: 'Gemini CLI',
    command: `gemini mcp add --transport sse aimparency "${url}"`,
    note: login ? 'Then /mcp auth aimparency in Gemini CLI to log in.' : ''
  },
  {
    id: 'other', name: 'Other',
    command: JSON.stringify({ mcpServers: { aimparency: { type: 'sse', url } } }, null, 2),
    note: 'For clients configured with an mcpServers JSON (Cursor, Claude Desktop through mcp-remote, …).'
  }
]

const agents = computed<Agent[]>(() => props.stdio ? stdioAgents(props.stdio) : urlAgents(props.url ?? '', props.login ?? false))

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
