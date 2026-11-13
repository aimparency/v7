// The login on a server with accounts. The token rides on the WebSocket's
// connection params; logging in or out on an open connection changes that
// connection on the server, and the token kept here is for the next one.
const KEY = 'aimparency-token'

export function loginToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function storeLoginToken(token: string | null) {
  agentCookie = null
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the login lasts until the next reload.
  }
}

// The server admins' agents gateway (/broker, /session/<port>) reads the login
// from an HttpOnly cookie, since browser WebSockets send no headers. Asked once
// per login; anyone else gets a refusal and no cookie.
let agentCookie: Promise<boolean> | null = null

export function ensureAgentCookie(): Promise<boolean> {
  agentCookie ??= fetch('/auth/agent-cookie', {
    method: 'POST',
    headers: { authorization: `Bearer ${loginToken() ?? ''}` },
  }).then(response => response.ok, () => false)
  return agentCookie
}
