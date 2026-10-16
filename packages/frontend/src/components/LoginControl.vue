<script setup lang="ts">
import { ref } from 'vue'
import { trpc } from '../trpc'
import { useDataStore } from '../stores/data'
import { useToastStore } from '../stores/toast'
import { setLoginToken } from '../utils/login'
import FormModalShell from './FormModalShell.vue'
import AccountsModal from './AccountsModal.vue'

// The header's account corner on a hosted instance: anyone reads, accounts write.
const dataStore = useDataStore()
const toastStore = useToastStore()
const dialog = ref<'login' | 'password' | 'accounts' | null>(null)
const name = ref('')
const password = ref('')
const current = ref('')
const error = ref('')
const busy = ref(false)

const open = (which: 'login' | 'password' | 'accounts') => {
  dialog.value = which
  name.value = password.value = current.value = error.value = ''
}

const submit = async (action: () => Promise<void>) => {
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

const login = () => submit(async () => {
  const { token } = await trpc.auth.login.mutate({ name: name.value, password: password.value })
  setLoginToken(token)
})

const changePassword = () => submit(async () => {
  const { token } = await trpc.auth.changeOwnPassword.mutate({ current: current.value, password: password.value })
  setLoginToken(token)
})

const logout = async () => {
  await trpc.auth.logout.mutate().catch(() => undefined)
  setLoginToken(null)
}

// The MCP acts as this account: its token is in the link, so share it like a password.
const copyMcpLink = async () => {
  try {
    const { token } = await trpc.auth.issueToken.mutate({ label: 'mcp' })
    await navigator.clipboard.writeText(`${window.location.origin}/mcp/sse?token=${token}`)
    toastStore.info('MCP link copied. It acts as you: keep it private.')
  } catch (caught) {
    toastStore.error('Could not create an MCP link', caught)
  }
}
</script>

<template>
  <div class="login-control">
    <button v-if="!dataStore.access.user" class="view-btn" @click="open('login')">Log in</button>
    <template v-else>
      <span class="who" :title="`role: ${dataStore.access.role}`">{{ dataStore.access.user }}</span>
      <button v-if="dataStore.access.role === 'admin'" class="view-btn" @click="open('accounts')">Accounts</button>
      <button class="view-btn" title="A link that lets an MCP client act as you" @click="copyMcpLink">MCP link</button>
      <button class="view-btn" @click="open('password')">Password</button>
      <button class="view-btn" @click="logout">Log out</button>
    </template>

    <FormModalShell :show="dialog === 'login'" title="Log in" width="min(90vw, 22rem)" @request-close="dialog = null">
      <form id="login-form" @submit.prevent="login">
        <input v-model="name" placeholder="Name" autocomplete="username" autofocus />
        <input v-model="password" type="password" placeholder="Password" autocomplete="current-password" />
        <p v-if="error" class="error">{{ error }}</p>
      </form>
      <template #footer>
        <button class="btn-primary" form="login-form" type="submit" :disabled="busy">Log in</button>
      </template>
    </FormModalShell>

    <FormModalShell :show="dialog === 'password'" title="Change password" width="min(90vw, 22rem)" @request-close="dialog = null">
      <form id="password-form" @submit.prevent="changePassword">
        <input v-model="current" type="password" placeholder="Current password" autocomplete="current-password" autofocus />
        <input v-model="password" type="password" placeholder="New password (8+ characters)" autocomplete="new-password" />
        <p v-if="error" class="error">{{ error }}</p>
      </form>
      <template #footer>
        <button class="btn-primary" form="password-form" type="submit" :disabled="busy">Change</button>
      </template>
    </FormModalShell>

    <AccountsModal v-if="dialog === 'accounts'" :me="dataStore.access.user" @close="dialog = null" />
  </div>
</template>

<style scoped>
.login-control {
  display: flex;
  align-items: center;
  gap: 0.25rem;

  .who {
    color: #aaa;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .error {
    color: #e57373;
    margin: 0;
  }
}
</style>
