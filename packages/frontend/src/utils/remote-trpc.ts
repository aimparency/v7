import { createTRPCProxyClient, createWSClient, getUntypedClient, wsLink } from '@trpc/client'
import type { AppRouter } from 'backend'
import { parseGraphHost } from 'shared'
import { clientId } from './mutation-activity'
import { mutationTrackingLink } from './mutation-tracking-link'
import { onServerLoginChange, serverLogin } from './server-logins'

// The API of another Aimparency server, for its spaces opened in place: read
// by anyone, written with the login this page holds there (server-logins.ts).
// One connection per server, opened when first needed and renewed when that
// login changes.
type Remote = { client: ReturnType<typeof createTRPCProxyClient<AppRouter>>; close: () => void }
const remotes = new Map<string, Remote>()

function wsUrl(origin: string): string {
  const url = new URL('/trpc', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

export function remoteTrpc(origin: string) {
  let remote = remotes.get(origin)
  if (!remote) {
    const ws = createWSClient({
      url: wsUrl(origin),
      connectionParams: () => ({ clientId, token: serverLogin(origin)?.token }),
      lazy: { enabled: true, closeMs: 60_000 }
    })
    remote = {
      client: createTRPCProxyClient<AppRouter>({ links: [mutationTrackingLink, wsLink({ client: ws })] }),
      close: () => ws.close()
    }
    remotes.set(origin, remote)
  }
  return remote.client
}

onServerLoginChange((origin) => {
  remotes.get(origin)?.close()
  remotes.delete(origin)
})

/** Where a space opened in place lives: its address here (a slug), or its address on another server. */
export function remoteSpace(address: string): { origin: string; graph: string } | null {
  const host = parseGraphHost(address)
  return host ? { origin: host.origin, graph: host.slug } : null
}

export function remoteUntyped(origin: string) {
  return getUntypedClient(remoteTrpc(origin))
}
