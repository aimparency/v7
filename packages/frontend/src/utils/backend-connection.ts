// Delay before the nth reconnect attempt of the backend socket: at once, then
// 250 ms doubling up to 2 s, so a restarting dev backend is back within ~1 s.
export const reconnectDelayMs = (attempt: number) => attempt === 0 ? 0 : Math.min(250 * 2 ** (attempt - 1), 2000)

// Set by the data store. Changes made while the socket was down never reach
// the subscription, so a reconnect has to resync.
export const backendConnection = {
  onDrop: () => {},
  onReconnect: () => {}
}

// Turns the socket's open/close callbacks into drop/reconnect: the first open
// is the initial connection, not a reconnect.
export function connectionCallbacks() {
  let opened = false
  return {
    onOpen: () => {
      if (opened) backendConnection.onReconnect()
      opened = true
    },
    onClose: () => {
      if (opened) backendConnection.onDrop()
    }
  }
}
