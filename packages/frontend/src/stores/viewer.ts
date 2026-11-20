import { defineStore } from 'pinia'
import { trpc } from '../trpc'
import { signLoginChallenge } from '../utils/browser-key'
import { storeLoginToken } from '../utils/login'
import { hasAccounts } from '../utils/runtime-config'
import { useDataStore } from './data'
import { useProjectStore } from './project-store'
import { useProjectLoadStore } from './project-load'
import { useToastStore } from './toast'

// Who is using this server (auth.me). Without login it is the person at the
// machine, who may do everything; with accounts it is the logged-in account, or
// nobody yet.
export const useViewerStore = defineStore('viewer', {
  state: () => ({
    name: null as string | null,
    serverAdmin: !hasAccounts(),
    canCreateGraphs: !hasAccounts(),
    // False for an account held only by this browser's key.
    permanentLogin: true,
    // How a visitor gets an account without the server admin (server.json).
    signUp: { open: false, browserKey: false, wallet: false },
    // The address people open this server at, when the server admin named it.
    publicUrl: null as string | null,
    // Who reads a space unless its owner set otherwise (server.json guestDefaults.read).
    read: 'everyone' as 'everyone' | 'accounts' | 'selected',
  }),

  getters: {
    // A visitor who would get an account the moment they need one.
    getsAccountAutomatically: (state) => hasAccounts() && state.name === null && state.signUp.browserKey,
    // A visitor who sees only the spaces open to everyone: logging in shows more.
    seesPublicSpacesOnly: (state) => hasAccounts() && state.name === null && state.read !== 'everyone',
  },

  actions: {
    // Never rejects: until the server answers, the defaults above hold.
    async load() {
      try {
        const { name, serverAdmin, canCreateGraphs, permanentLogin, signUp, publicUrl, read } = await trpc.auth.me.query()
        Object.assign(this, { name, serverAdmin, canCreateGraphs, permanentLogin, signUp, publicUrl, read })
      } catch (error) {
        useToastStore().error('Could not ask the server who you are', error)
      }
    },

    // After the server logged this connection in or out: keep the token for the
    // next connection and ask again who we are, here and on the open graph.
    async loginChanged(token: string | null) {
      storeLoginToken(token)
      await this.load()
      const projectPath = useProjectStore().projectPath
      if (!projectPath) return
      try {
        await useDataStore().refreshAccess(projectPath)
      } catch {
        // Logged out of a space open to accounts only: opening it again shows why, and the login.
        void useProjectLoadStore().open(projectPath)
      }
    },

    // Before something that needs an account. Where the server gives accounts
    // automatically, the visitor gets one now, held by a key in this browser.
    async ensureAccount(): Promise<boolean> {
      if (!hasAccounts() || this.name !== null) return true
      if (!this.signUp.browserKey) {
        useToastStore().error('Log in first')
        return false
      }
      try {
        const { nonce } = await trpc.auth.keyChallenge.mutate()
        const { token } = await trpc.auth.keyLogin.mutate({ nonce, ...await signLoginChallenge(nonce) })
        await this.loginChanged(token)
        return this.name !== null
      } catch (error) {
        useToastStore().error('Could not create an account for this browser', error)
        return false
      }
    }
  }
})
