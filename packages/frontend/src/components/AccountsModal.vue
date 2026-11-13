<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ADMIN_SHELL_WARNING } from 'shared'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'

// The server admin manages the accounts of this server. What an account may do
// on a graph is set on that graph, by its owner.
defineProps<{ me: string | null }>()
const emit = defineEmits<{ close: [] }>()

type Account = { name: string, serverAdmin: boolean, canCreateGraphs: boolean }
type Right = 'serverAdmin' | 'canCreateGraphs'

const accounts = ref<Account[]>([])
const name = ref('')
const password = ref('')
const error = ref('')

const run = async (action: () => Promise<unknown>) => {
  error.value = ''
  try {
    await action()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  // Also after a refusal: the boxes show what the server holds.
  accounts.value = await trpc.auth.listAccounts.query().catch(() => accounts.value)
}

const add = () => run(async () => {
  await trpc.auth.createAccount.mutate({ name: name.value, password: password.value })
  name.value = password.value = ''
})

// Making someone server admin hands out a shell on the server: ask every time.
// Afterwards the box shows what the server holds, also when declined or refused.
const setRight = async (account: Account, right: Right, box: HTMLInputElement) => {
  const value = box.checked
  const confirmed = right !== 'serverAdmin' || !value
    || window.confirm(`Make ${account.name} server admin?\n\n${ADMIN_SHELL_WARNING}`)
  if (confirmed) await run(() => trpc.auth.setRights.mutate({ name: account.name, [right]: value }))
  box.checked = accounts.value.find(candidate => candidate.name === account.name)?.[right] ?? false
}

const remove = (account: string) => run(() => trpc.auth.removeAccount.mutate({ name: account }))

const resetPassword = (account: string) => {
  const next = window.prompt(`New password for ${account} (8+ characters)`)
  if (next) void run(() => trpc.auth.setPassword.mutate({ name: account, password: next }))
}

onMounted(() => run(async () => undefined))
</script>

<template>
  <FormModalShell show title="Accounts" width="min(90vw, 40rem)" @request-close="emit('close')">
    <div class="accounts">
      <div v-for="account in accounts" :key="account.name" class="row">
        <span class="name">{{ account.name }}{{ account.name === me ? ' (you)' : '' }}</span>
        <label><input type="checkbox" :checked="account.canCreateGraphs" @change="setRight(account, 'canCreateGraphs', $event.target as HTMLInputElement)" /> creates graphs</label>
        <label><input type="checkbox" :checked="account.serverAdmin" @change="setRight(account, 'serverAdmin', $event.target as HTMLInputElement)" /> server admin</label>
        <button class="btn-secondary" @click="resetPassword(account.name)">Password</button>
        <button class="btn-secondary" :disabled="account.name === me" @click="remove(account.name)">Remove</button>
      </div>

      <form class="row" @submit.prevent="add">
        <input v-model="name" class="name" placeholder="Name" />
        <input v-model="password" type="password" placeholder="Password" autocomplete="new-password" />
        <button class="btn-primary" type="submit">Add</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="hint">"creates graphs" matters where the server lets only selected accounts create graphs. Who may write a graph is set in that graph's settings, by its owner.</p>
      <p class="hint warning">{{ ADMIN_SHELL_WARNING }}</p>
    </div>
  </FormModalShell>
</template>

<style scoped>
.accounts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .row {
    display: flex;
    gap: 0.375rem;
    align-items: center;

    .name {
      flex: 1;
    }
  }

  .error {
    color: #e57373;
    margin: 0;
  }

  .hint {
    color: #888;
    margin: 0;

    &.warning {
      color: #e0a050;
    }
  }
}
</style>
