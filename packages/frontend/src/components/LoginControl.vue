<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChevronDown, CircleAlert, CircleUser, KeyRound, LogOut, Plug, Server, Users } from 'lucide-vue-next'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import { browserWallets, signWithWallet, type Wallet } from '../utils/wallets'
import FormModalShell from './FormModalShell.vue'
import AccountsModal from './AccountsModal.vue'
import McpConnectModal from './McpConnectModal.vue'
import ServerSettingsModal from './ServerSettingsModal.vue'

// The account corner on a server with accounts: anyone reads, accounts write
// the graphs they own or were given.
const viewer = useViewerStore()
type Dialog = 'login' | 'sign-up' | 'password' | 'permanent' | 'accounts' | 'server' | 'mcp'
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
onMounted(() => { if (invitation.value) open('sign-up') })

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
  const { token } = await trpc.auth.signUp.mutate({ name: name.value, password: password.value, invitation: invitation.value || undefined })
  forgetInvitation()
  await viewer.loginChanged(token)
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

const logout = async () => {
  menuOpen.value = false
  await trpc.auth.logout.mutate().catch(() => undefined)
  await viewer.loginChanged(null)
}

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
        @click="menuOpen = !menuOpen"
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
        <template v-if="viewer.serverAdmin">
          <div class="menu-separator"></div>
          <button class="menu-item" role="menuitem" @click="open('accounts')"><Users /> Accounts</button>
          <button class="menu-item" role="menuitem" @click="open('server')"><Server /> Server settings</button>
        </template>
        <div class="menu-separator"></div>
        <button class="menu-item" role="menuitem" @click="logout"><LogOut /> Log out</button>
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
        <p v-if="invitation" class="hint">You were invited to this server.</p>
        <input v-model="name" placeholder="Name" autocomplete="username" autofocus />
        <input v-model="password" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" />
        <p v-if="error" class="error">{{ error }}</p>
      </form>
      <template #footer>
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
