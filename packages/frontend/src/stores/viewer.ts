import { defineStore } from 'pinia'
import { trpc } from '../trpc'
import { useToastStore } from './toast'
import { hasAccounts } from '../utils/runtime-config'

// Who is using this server (auth.me). Without login it is the person at the
// machine, who may do everything; with accounts it is the logged-in account, or
// nobody yet.
export const useViewerStore = defineStore('viewer', {
  state: () => ({
    name: null as string | null,
    serverAdmin: !hasAccounts(),
    canCreateGraphs: !hasAccounts(),
  }),

  actions: {
    // Never rejects: until the server answers, the defaults above hold.
    async load() {
      try {
        const { name, serverAdmin, canCreateGraphs } = await trpc.auth.me.query()
        Object.assign(this, { name, serverAdmin, canCreateGraphs })
      } catch (error) {
        useToastStore().error('Could not ask the server who you are', error)
      }
    }
  }
})
