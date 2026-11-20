<script setup lang="ts">
import { ref, watch } from 'vue'
import { Bot, X } from 'lucide-vue-next'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import { useProjectStore } from '../stores/project-store'
import { useProjectLoadStore } from '../stores/project-load'
import McpConnectModal from './McpConnectModal.vue'

// Asks an account, each time it opens a space, to connect its AI assistant
// (an MCP client), until it has one or has said "not now" three times. The
// count is kept in this browser, per server and account.
const viewer = useViewerStore()
const projectStore = useProjectStore()
const projectLoad = useProjectLoadStore()

const MAX_DISMISSALS = 3
const storageKey = () => `aimparency.mcpOffer.${window.location.origin}.${viewer.name}`
const dismissals = (): number => {
  try {
    return Number(JSON.parse(localStorage.getItem(storageKey()) ?? '{}').dismissed) || 0
  } catch {
    return 0
  }
}
const remember = (dismissed: number) => {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ dismissed }))
  } catch {
    // No storage (private window): it asks again next time, which is all that is lost.
  }
}

const shown = ref(false)
const connecting = ref(false)

// Connected already: an MCP client holds a token of the account (the browsers
// it is logged in at hold ones labelled "browser").
const hasAssistant = async () => {
  const tokens = await trpc.auth.listTokens.query().catch(() => null)
  return tokens === null || tokens.some(token => token.label !== 'browser')
}

const offer = async () => {
  if (!viewer.name || dismissals() >= MAX_DISMISSALS) return
  if (await hasAssistant()) return
  shown.value = true
}

// A space has opened: its load went from loading to done.
watch(() => projectLoad.status, (status, before) => {
  if (before === 'loading' && status === 'idle' && projectStore.projectPath) void offer()
})

const notNow = () => {
  shown.value = false
  remember(dismissals() + 1)
}
const connect = () => {
  shown.value = false
  connecting.value = true
}
</script>

<template>
  <aside v-if="shown" class="mcp-offer" role="dialog" aria-label="Connect your AI assistant">
    <button class="close" type="button" title="Not now" @click="notNow"><X /></button>
    <div class="title"><Bot /> Connect your AI assistant</div>
    <p>
      Let Claude, Codex or any other MCP client work in your spaces with you: it reads the ideas,
      adds and links new ones and keeps statuses up to date, as you.
    </p>
    <div class="actions">
      <button class="btn-secondary" type="button" @click="notNow">Not now</button>
      <button class="btn-primary" type="button" @click="connect">Connect</button>
    </div>
  </aside>
  <McpConnectModal v-if="connecting" @close="connecting = false" />
</template>

<style scoped>
.mcp-offer {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 150;
  width: min(calc(100vw - 2rem), 24rem);
  padding: 1rem;
  background: #2d2d2d;
  border: 1px solid var(--accent, #6aa0ff);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    padding-right: 1.5rem;
  }
  p { margin: 0; color: #ccc; }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: none;
    border: none;
    color: #aaa;
    cursor: pointer;
  }
}
</style>
