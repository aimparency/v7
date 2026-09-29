// Identifies this tab to the backend; change events carry it back as `origin`,
// which is how the undo history tells its own changes from other clients'.
// (randomUUID is missing on plain-http LAN hosts, hence the fallback.)
export const clientId = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// Observed by the undo history to group the mutations of one user action.
export const mutationActivity = {
  onStart: (_path: string) => {},
  onEnd: (_path: string) => {}
}
