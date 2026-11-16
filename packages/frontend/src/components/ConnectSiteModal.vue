<script setup lang="ts">
import { computed, ref } from 'vue'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import { CONNECT_MESSAGE, type ConnectReply } from '../utils/server-logins'
import FormModalShell from './FormModalShell.vue'
import LoginControl from './LoginControl.vue'

// The page of another Aimparency website opened this tab
// (?connect-site=<its origin>&connect-state=<its nonce>): a space of this
// server is open there, and the person wants to change it from there. One
// click lets that website's pages act as them here; the login goes back to
// the page that asked, in the browser, and to nobody else.
const props = defineProps<{ site: string; state: string }>()
const emit = defineEmits<{ close: [] }>()

const viewer = useViewerStore()
const error = ref('')
const done = ref('')
const busy = ref(false)

const siteHost = computed(() => {
  try {
    return new URL(props.site).host
  } catch {
    return props.site
  }
})
const here = window.location.host
const opener = window.opener as Window | null

function reply(message: Omit<ConnectReply, 'type' | 'state'>) {
  opener?.postMessage({ type: CONNECT_MESSAGE, state: props.state, ...message } satisfies ConnectReply, props.site)
}

function leave(message: string) {
  done.value = message
  // A tab opened by a script may close itself; one opened otherwise stays with the message.
  window.close()
}

async function allow() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (!opener) throw new Error(`Start again from ${siteHost.value}: this tab does not know the page that asked.`)
    // Where the server gives accounts automatically, the visitor gets theirs now.
    if (!await viewer.ensureAccount()) throw new Error('Log in first.')
    const { token, account } = await trpc.auth.grantSite.mutate({ site: props.site })
    reply({ token, account })
    leave(`Done: ${siteHost.value} acts as ${account} here. Go back to its tab.`)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

function refuse() {
  reply({ refused: true })
  leave(`Refused. Go back to ${siteHost.value}.`)
}

function close() {
  if (!done.value) reply({ refused: true })
  emit('close')
}
</script>

<template>
  <FormModalShell show :title="`Let ${siteHost} act as you`" width="min(92vw, 32rem)" @request-close="close">
    <div class="stack">
      <p v-if="done">{{ done }}</p>
      <template v-else>
        <p>
          A space of <strong>{{ here }}</strong> is open on <strong>{{ siteHost }}</strong>.
          To change it there, let that page act as you here.
        </p>
        <p class="hint">
          It may change what you may change on {{ here }} and leave notes, from {{ siteHost }} only.
          It cannot change your account here. You can take it back here, under Connect an agent (MCP).
        </p>
        <p v-if="viewer.name" class="hint">You are {{ viewer.name }} here.</p>
        <template v-else-if="!viewer.getsAccountAutomatically">
          <p class="hint">Log in here first, so it is clear whom it acts as.</p>
          <LoginControl />
        </template>
        <p v-if="error" class="error">{{ error }}</p>
      </template>
    </div>
    <template v-if="!done" #footer>
      <button class="btn-secondary" :disabled="busy" @click="refuse">Refuse</button>
      <button class="btn-primary" :disabled="busy || !(viewer.name || viewer.getsAccountAutomatically)" @click="allow">Allow</button>
    </template>
  </FormModalShell>
</template>
