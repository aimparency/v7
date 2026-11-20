<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronDown, CircleAlert, CircleUser, KeyRound, LogOut, Plug, Server, Trash2, Users } from 'lucide-vue-next'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import { browserWallets, signWithWallet, type Wallet } from '../utils/wallets'
import { forgetBrowserKey } from '../utils/browser-key'
import { serverLogins, storeServerLogin } from '../utils/server-logins'
import { logOutOfServers, remoteTrpc } from '../utils/remote-trpc'
import { useDataStore } from '../stores/data'
import { useProjectLoadStore } from '../stores/project-load'
import { useToastStore } from '../stores/toast'
import FormModalShell from './FormModalShell.vue'
import AccountsModal from './AccountsModal.vue'
import McpConnectModal from './McpConnectModal.vue'
import ServerSettingsModal from './ServerSettingsModal.vue'

// The account corner on a server with accounts: anyone reads, accounts write
// the graphs they own or were given.
const viewer = useViewerStore()
type Dialog = 'login' | 'sign-up' | 'password' | 'permanent' | 'accounts' | 'server' | 'mcp' | 'discard'
const dialog = ref<Dialog | null>(null)
const name = ref('')
const password = ref('')
const current = ref('')
const error = ref('')
const busy = ref(false)

// ?invitation=<code>: a link from the server admin that lets its holder create an account.
const invitation = ref(new URLSearchParams(window.location.search).get('invitation') ?? '')
const maySignUp = computed(() => viewer.signUp.open || invitation.value !== '')
const forgetInvitation = () => {
  invitation.value = ''
  const url = new URL(window.location.href)
  url.searchParams.delete('invitation')
  window.history.replaceState({}, '', url)
}

// The account's own things sit in one menu under its name.
const root = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const closeMenuOutside = (event: PointerEvent) => {
  if (menuOpen.value && !root.value?.contains(event.target as Node)) menuOpen.value = false
}
const closeMenuOnEscape = (event: KeyboardEvent) => {
  if (menuOpen.value && event.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', closeMenuOutside)
  document.addEventListener('keydown', closeMenuOnEscape)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', closeMenuOutside)
  document.removeEventListener('keydown', closeMenuOnEscape)
})

const open = (which: Dialog) => {
  menuOpen.value = false
  dialog.value = which
  name.value = password.value = current.value = error.value = ''
}
// An invitation to one space: a new account takes it at sign-up; an account
// that exists takes it once logged in, and the space opens.
type InvitationInfo = Awaited<ReturnType<typeof trpc.auth.invitationInfo.query>>
const invitationInfo = ref<InvitationInfo | null>(null)
const invitedSentence = computed(() => {
  const space = invitationInfo.value?.space
  if (invitationInfo.value && !invitationInfo.value.valid) return 'This invitation is not valid any more.'
  if (!space) return 'You were invited to this server.'
  return `You were invited to the space "${space.name}", to ${invitationInfo.value?.right === 'write' ? 'work on it' : 'read it'}.`
})
const openSpace = (slug: string | null) => { if (slug) void useProjectLoadStore().open(slug) }
const takeInvitation = async () => {
  const code = invitation.value
  if (!code || !viewer.name || !invitationInfo.value?.space) return
  // Another login control on the page may have taken it already (it leaves the address then).
  if (new URLSearchParams(window.location.search).get('invitation') !== code) return
  forgetInvitation()
  if (dialog.value === 'sign-up') dialog.value = null
  try {
    openSpace((await trpc.auth.acceptInvitation.mutate({ invitation: code })).space)
  } catch (caught) {
    useToastStore().error('Could not take the invitation', caught)
  }
}
watch([() => viewer.name, invitationInfo], () => void takeInvitation())
onMounted(async () => {
  if (!invitation.value) return
  if (!viewer.name) open('sign-up')
  try {
    invitationInfo.value = await trpc.auth.invitationInfo.query({ invitation: invitation.value })
  } catch {
    // Unknown here: the sign-up says what is wrong with it.
  }
})

const submit = async (action: () => Promise<void>) => {
  busy.value = true
  error.value = ''
  try {
    await action()
    dialog.value = null
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

const login = () => submit(async () => {
  const { token } = await trpc.auth.login.mutate({ name: name.value, password: password.value })
  await viewer.loginChanged(token)
})

const signUp = () => submit(async () => {
  const { token, space } = await trpc.auth.signUp.mutate({ name: name.value, password: password.value, invitation: invitation.value || undefined })
  forgetInvitation()
  await viewer.loginChanged(token)
  openSpace(space)
})

const changePassword = () => submit(async () => {
  const { token } = await trpc.auth.changeOwnPassword.mutate({ current: current.value, password: password.value })
  await viewer.loginChanged(token)
})

// Login with a crypto wallet: it signs a message this server wrote for it.
const wallets = browserWallets()
const walletChallenge = async (address: string, chainId: number) =>
  (await trpc.auth.walletChallenge.mutate({ address, chainId })).message

const walletLogin = (wallet: Wallet) => submit(async () => {
  const { token } = await trpc.auth.walletLogin.mutate(await signWithWallet(wallet, walletChallenge))
  await viewer.loginChanged(token)
})

// An automatic account takes a wallet as its permanent login.
const keepWithWallet = (wallet: Wallet) => submit(async () => {
  await trpc.auth.addWallet.mutate(await signWithWallet(wallet, walletChallenge))
  await viewer.load()
})

// An automatic account chooses its name and password; it stays logged in.
const makePermanent = () => submit(async () => {
  await trpc.auth.makePermanent.mutate({ name: name.value, password: password.value })
  await viewer.load()
})

// Logging out here logs out of the other servers too: the browser is left to nobody.
const logOutElsewhereToo = async () => {
  const origins = await logOutOfServers()
  refreshElsewhere()
  for (const origin of origins) await useDataStore().reopenSpacesAt(origin)
}

const logout = async () => {
  menuOpen.value = false
  await trpc.auth.logout.mutate().catch(() => undefined)
  await logOutElsewhereToo()
  await viewer.loginChanged(null)
}

// Logins this page holds at other servers, for their spaces opened in place
// (utils/server-logins.ts). Logging out there gives the login back to that server.
const elsewhere = ref(serverLogins())
const refreshElsewhere = () => { elsewhere.value = serverLogins() }
const hostOf = (origin: string) => new URL(origin).host
const logoutElsewhere = async (origin: string) => {
  menuOpen.value = false
  await remoteTrpc(origin).auth.logout.mutate().catch(() => undefined)
  storeServerLogin(origin, null)
  refreshElsewhere()
  await useDataStore().reopenSpacesAt(origin)
}

// An account held only by this browser's key cannot be logged into again
// after logging out: it is discarded, with what it made.
type Footprint = Awaited<ReturnType<typeof trpc.auth.ownFootprint.query>>
const footprint = ref<Footprint>(null)
const openDiscard = async () => {
  open('discard')
  footprint.value = await trpc.auth.ownFootprint.query().catch(() => null)
}
const discard = () => submit(async () => {
  await trpc.auth.discardOwnAccount.mutate()
  await forgetBrowserKey().catch(() => undefined)
  await logOutElsewhereToo()
  await viewer.loginChanged(null)
})
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

</script>

<template>
  <div ref="root" class="login-control">
    <template v-if="!viewer.name">
      <button class="icon-btn text" @click="open('login')">Log in</button>
      <button v-if="maySignUp" class="icon-btn text" @click="open('sign-up')">Create account</button>
    </template>
    <div v-else class="menu-anchor">
      <button
        class="icon-btn text account-btn"
        :class="{ on: menuOpen, attention: !viewer.permanentLogin }"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        :title="viewer.permanentLogin ? 'Your account' : 'This account lives only in this browser'"
        @click="menuOpen = !menuOpen; refreshElsewhere()"
      >
        <CircleAlert v-if="!viewer.permanentLogin" /><CircleUser v-else />
        <span class="account-name">{{ viewer.name }}</span>
        <ChevronDown />
      </button>
      <div v-if="menuOpen" class="menu" role="menu">
        <div class="menu-label">{{ viewer.name }} · {{ viewer.serverAdmin ? 'server admin' : 'account' }}</div>
        <button
          v-if="!viewer.permanentLogin"
          class="menu-item attention"
          role="menuitem"
          title="This account lives only in this browser: clearing the browser's data loses it. Choose a name and a password to keep it."
          @click="open('permanent')"
        ><CircleAlert /> Keep account</button>
        <button class="menu-item" role="menuitem" title="Let an MCP client, such as a coding agent, act as you" @click="open('mcp')"><Plug /> Connect an agent (MCP)</button>
        <button v-if="viewer.permanentLogin" class="menu-item" role="menuitem" @click="open('password')"><KeyRound /> Password</button>
        <template v-if="elsewhere.length > 0">
          <div class="menu-separator"></div>
          <div class="menu-label">Logged in elsewhere, for spaces shown here</div>
          <button
            v-for="login in elsewhere"
            :key="login.origin"
            class="menu-item"
            role="menuitem"
            :title="`Log out of ${hostOf(login.origin)}: its spaces become read-only here`"
            @click="logoutElsewhere(login.origin)"
          ><LogOut /> {{ login.account }} at {{ hostOf(login.origin) }}</button>
        </template>
        <template v-if="viewer.serverAdmin">
          <div class="menu-separator"></div>
          <button class="menu-item" role="menuitem" @click="open('accounts')"><Users /> Accounts</button>
          <button class="menu-item" role="menuitem" @click="open('server')"><Server /> Server settings</button>
        </template>
        <div class="menu-separator"></div>
        <button v-if="viewer.permanentLogin" class="menu-item" role="menuitem" @click="logout"><LogOut /> Log out</button>
        <button
          v-else
          class="menu-item"
          role="menuitem"
          title="This account has no login but this browser's key: once logged out, nobody can get it back"
          @click="openDiscard"
        ><Trash2 /> Discard account</button>
      </div>
    </div>

    <FormModalShell :show="dialog === 'login'" title="Log in" width="min(90vw, 22rem)" @request-close="dialog = null">
      <form id="login-form" @submit.prevent="login">
        <input v-model="name" placeholder="Name" autocomplete="username" autofocus />
        <input v-model="password" type="password" placeholder="Password" autocomplete="current-password" />
        <p v-if="error" class="error">{{ error }}</p>
      </form>
      <template #footer>
        <template v-if="viewer.signUp.wallet">
          <button v-for="wallet in wallets" :key="wallet.id" class="btn-secondary" type="button" :disabled="busy" @click="walletLogin(wallet)">{{ wallet.name }}</button>
        </template>
        <button class="btn-primary" form="login-form" type="submit" :disabled="busy">Log in</button>
      </template>
    </FormModalShell>

    <FormModalShell :show="dialog === 'sign-up'" title="Create account" width="min(90vw, 22rem)" @request-close="dialog = null">
      <form id="sign-up-form" @submit.prevent="signUp">
        <p v-if="invitation" class="hint">{{ invitedSentence }}</p>
        <input v-model="name" placeholder="Name" autocomplete="username" autofocus />
        <input v-model="password" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" />
        <p v-if="error" class="error">{{ error }}</p>
      </form>
      <template #footer>
        <button v-if="invitationInfo?.space" class="btn-secondary" type="button" @click="open('login')">I have an account</button>
        <button class="btn-primary" form="sign-up-form" type="submit" :disabled="busy">Create account</button>
      </template>
    </FormModalShell>

    <FormModalShell :show="dialog === 'permanent'" title="Keep this account" width="min(90vw, 22rem)" @request-close="dialog = null">
      <form id="permanent-form" @submit.prevent="makePermanent">
        <p class="hint">So far this account lives only in this browser. With a name and a password you can log in from anywhere, and it survives clearing the browser.</p>
        <input v-model="name" placeholder="Name" autocomplete="username" autofocus />
        <input v-model="password" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" />
        <p v-if="error" class="error">{{ error }}</p>
      </form>
      <template #footer>
        <template v-if="viewer.signUp.wallet">
          <button v-for="wallet in wallets" :key="wallet.id" class="btn-secondary" type="button" :disabled="busy" @click="keepWithWallet(wallet)">Keep with {{ wallet.name }}</button>
        </template>
        <button class="btn-primary" form="permanent-form" type="submit" :disabled="busy">Keep account</button>
      </template>
    </FormModalShell>

    <FormModalShell :show="dialog === 'discard'" title="Discard this account?" width="min(90vw, 26rem)" @request-close="dialog = null">
      <div class="stack">
        <p class="hint">{{ viewer.name }} lives only in this browser: it has no password, so once you leave it nobody can log into it again. Discarding it removes what it made:</p>
        <ul v-if="footprint" class="footprint">
          <li v-if="footprint.spaces.length">{{ plural(footprint.spaces.length, 'space', 'spaces') }}: {{ footprint.spaces.join(', ') }}</li>
          <li>{{ plural(footprint.notes, 'note', 'notes') }} and {{ plural(footprint.offers, 'offer', 'offers') }} on other spaces</li>
        </ul>
        <p class="hint">To keep it, choose a name and a password instead.</p>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-secondary" type="button" :disabled="busy" @click="open('permanent')">Keep account</button>
        <button class="btn-danger" type="button" :disabled="busy" @click="discard">Discard account</button>
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

    <AccountsModal v-if="dialog === 'accounts'" :me="viewer.name" @close="dialog = null" />
    <McpConnectModal v-if="dialog === 'mcp'" @close="dialog = null" />
    <ServerSettingsModal v-if="dialog === 'server'" @close="dialog = null" />
  </div>
</template>

<style scoped>
.footprint {
  margin: 0;
  padding-left: 1.2rem;
  overflow-wrap: anywhere;
}

.login-control {
  display: flex;
  align-items: center;
  gap: var(--gap-s);

  .account-btn {
    &.attention { color: var(--status-unclear); border-color: var(--status-unclear); }
  }

  .account-name {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-m);
  }
}
</style>
