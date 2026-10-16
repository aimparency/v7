// The login of a hosted instance. The token rides on the WebSocket's connection
// params, which are sent once per connection, so logging in or out reloads.
const KEY = 'aimparency-token'

export function loginToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLoginToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the login lasts until the next reload.
  }
  window.location.reload()
}
