// Logins at other Aimparency servers, kept by this page only. A space of
// another server opened in place is read from that server directly; to change
// it, this page needs a login there. The person gives it on that server's own
// page (auth.grantSite): it opens in a new tab, they allow it with one click,
// and the login comes back to this page in the browser (postMessage to this
// origin). The server of this page never sees it. That server accepts it only
// from pages of this website.

export type ServerLogin = { token: string; account: string }

const KEY = 'aimparency-server-logins'
const listeners = new Set<(origin: string) => void>()

function readAll(): Record<string, ServerLogin> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, ServerLogin> : {}
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, ServerLogin>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Without storage a login lasts until the next reload: kept below.
  }
  memory = all
}

let memory: Record<string, ServerLogin> | null = null
const all = () => memory ?? (memory = readAll())

export function serverLogin(origin: string): ServerLogin | null {
  return all()[origin] ?? null
}

export function serverLogins(): Array<ServerLogin & { origin: string }> {
  return Object.entries(all()).map(([origin, login]) => ({ origin, ...login }))
}

export function storeServerLogin(origin: string, login: ServerLogin | null) {
  const next = { ...all() }
  if (login) next[origin] = login
  else delete next[origin]
  writeAll(next)
  for (const listener of listeners) listener(origin)
}

/** Called with the server's origin whenever its login here changes. */
export function onServerLoginChange(listener: (origin: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const CONNECT_MESSAGE = 'aimparency-server-login'

/** What the granting page sends back to the page that asked (ConnectSiteModal). */
export type ConnectReply = { type: typeof CONNECT_MESSAGE; state: string; token?: string; account?: string; refused?: boolean }

export class LoginRefusedError extends Error {
  constructor(host: string) {
    super(`No login at ${host}.`)
    this.name = 'LoginRefusedError'
  }
}

/**
 * Opens the server's own page in a new tab, where the person allows this page
 * to act as them there. Call it from a click: browsers open tabs for clicks.
 * Resolves with the login once they allowed it; rejects when they refused or
 * closed the tab.
 */
export function connectToServer(origin: string): Promise<ServerLogin> {
  const state = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const url = new URL('/', origin)
  url.searchParams.set('connect-site', window.location.origin)
  url.searchParams.set('connect-state', state)
  const tab = window.open(url.href, '_blank')
  const host = new URL(origin).host
  if (!tab) return Promise.reject(new Error(`The browser did not open ${host}: allow pop-ups for this page and try again.`))
  return new Promise((resolve, reject) => {
    const finish = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(watch)
    }
    const onMessage = (event: MessageEvent) => {
      const reply = event.data as Partial<ConnectReply> | null
      if (event.origin !== origin || reply?.type !== CONNECT_MESSAGE || reply.state !== state) return
      finish()
      if (reply.refused || !reply.token || !reply.account) return reject(new LoginRefusedError(host))
      const login = { token: reply.token, account: reply.account }
      storeServerLogin(origin, login)
      resolve(login)
    }
    window.addEventListener('message', onMessage)
    // Closed without an answer.
    const watch = setInterval(() => {
      if (!tab.closed) return
      finish()
      reject(new LoginRefusedError(host))
    }, 500)
  })
}
