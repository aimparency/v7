<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ADMIN_SHELL_WARNING } from 'shared'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import AccountRights, { type Rights } from './AccountRights.vue'

// The server admin manages the accounts of this server. What an account may do
// on a graph is set on that graph, by its owner.
defineProps<{ me: string | null }>()
const emit = defineEmits<{ close: [] }>()

type Account = { name: string } & Rights

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

const setRights = (account: Account) => (change: Partial<Rights>) =>
  run(() => trpc.auth.setRights.mutate({ name: account.name, ...change }))

const remove = (account: string) => run(() => trpc.auth.removeAccount.mutate({ name: account }))

// Invitations: links that let their holder create an account, also where
// sign-up is closed. The link is shown once; the server keeps only a hash.
const invitations = ref<Awaited<ReturnType<typeof trpc.auth.listInvitations.query>>>([])
const invitationOnce = ref(true)
const invitationDays = ref<number | null>(null)
const invitationLink = ref('')
// The rights of the accounts made with the next invitation, as for an existing account.
const invitationRights = reactive<Rights>({ serverAdmin: false, canCreateGraphs: false })
const setInvitationRights = (change: Partial<Rights>) => Object.assign(invitationRights, change)
const invitationAdminUnavailable = computed(() =>
  invitationOnce.value ? undefined : 'Only an invitation for one person can make a server admin.')
const loadInvitations = async () => {
  invitations.value = await trpc.auth.listInvitations.query().catch(() => invitations.value)
}
const invite = () => run(async () => {
  const { code } = await trpc.auth.createInvitation.mutate({
    kind: invitationOnce.value ? 'once' : 'permanent',
    days: invitationDays.value || undefined,
    ...(invitationRights.serverAdmin && invitationOnce.value ? { serverAdmin: true } : {}),
    ...(invitationRights.canCreateGraphs ? { canCreateGraphs: true } : {})
  })
  invitationLink.value = `${window.location.origin}/?invitation=${code}`
  await loadInvitations()
})
const uninvite = (id: string) => run(async () => {
  await trpc.auth.removeInvitation.mutate({ id })
  await loadInvitations()
})
const describeInvitation = (invitation: (typeof invitations.value)[number]) => [
  invitation.kind === 'once' ? 'for one person' : 'for anyone with the link',
  invitation.redeemedBy ? `used by ${invitation.redeemedBy}`
    : invitation.expiresAt ? `until ${new Date(invitation.expiresAt).toLocaleDateString()}` : 'no end',
  ...(invitation.serverAdmin ? ['server admin'] : []),
  ...(invitation.canCreateGraphs ? ['creates graphs'] : [])
].join(' · ')

const resetPassword = (account: string) => {
  const next = window.prompt(`New password for ${account} (8+ characters)`)
  if (next) void run(() => trpc.auth.setPassword.mutate({ name: account, password: next }))
}

onMounted(() => run(loadInvitations))
</script>

<template>
  <FormModalShell show title="Accounts" width="min(90vw, 40rem)" @request-close="emit('close')">
    <div class="accounts stack">
      <div v-for="account in accounts" :key="account.name" class="row">
        <span class="name">{{ account.name }}{{ account.name === me ? ' (you)' : '' }}</span>
        <AccountRights :rights="account" :who="account.name" :apply="setRights(account)" />
        <button class="btn-secondary" @click="resetPassword(account.name)">Password</button>
        <button class="btn-secondary" :disabled="account.name === me" @click="remove(account.name)">Remove</button>
      </div>

      <form class="row" @submit.prevent="add">
        <input v-model="name" class="name" placeholder="Name" />
        <input v-model="password" type="password" placeholder="Password" autocomplete="new-password" />
        <button class="btn-primary" type="submit">Add</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>

      <h4 class="section-title">Invitations</h4>
      <div v-for="invitation in invitations" :key="invitation.id" class="row">
        <span class="name">{{ describeInvitation(invitation) }}</span>
        <button class="btn-secondary" @click="uninvite(invitation.id)">Remove</button>
      </div>
      <form class="stack invite" @submit.prevent="invite">
        <div class="row">
          <label class="check"><input v-model="invitationOnce" type="checkbox" /> for one person only</label>
          <input v-model.number="invitationDays" type="number" min="1" placeholder="Valid for days (empty: no end)" />
        </div>
        <div class="row">
          <AccountRights
            :rights="invitationRights"
            who="whoever uses this invitation"
            :apply="setInvitationRights"
            :admin-unavailable="invitationAdminUnavailable"
          />
          <span class="name"></span>
          <button class="btn-primary" type="submit">Invite</button>
        </div>
      </form>
      <template v-if="invitationLink"><p class="hint">Send this link; it is shown only now:</p><code class="copyable">{{ invitationLink }}</code></template>

      <p class="hint">"creates graphs" matters where the server lets only selected accounts create graphs. Who may write a graph is set in that graph's settings, by its owner.</p>
      <p class="hint warning">{{ ADMIN_SHELL_WARNING }}</p>
    </div>
  </FormModalShell>
</template>

<style scoped>
.accounts {
  .row .name {
    flex: 1 1 10rem;
    min-width: 0;
  }

  .invite {
    gap: var(--gap-s);
  }
}
</style>
