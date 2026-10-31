import type { IdeaActivity } from 'shared'
import { trpc } from '../trpc'

// Recent agent and manual access per idea, for the graph's Activity color
// mode. A plain map, not reactive state: the renderer reads it every frame.
export const ideaActivity = new Map<string, IdeaActivity>()

let subscription: { unsubscribe: () => void } | null = null

export function followIdeaActivity(projectPath: string) {
  subscription?.unsubscribe()
  ideaActivity.clear()
  subscription = trpc.activity.onAccess.subscribe({ projectPath }, {
    onData: ({ ideaIds, kind, at }) => {
      for (const ideaId of ideaIds) ideaActivity.set(ideaId, { ...ideaActivity.get(ideaId), [kind]: at })
    },
    onError: (error) => console.warn('Idea activity feed stopped', error)
  })
  void trpc.activity.snapshot.query({ projectPath }).then((snapshot) => {
    // Accesses that arrived meanwhile are newer than the snapshot's.
    for (const [ideaId, activity] of Object.entries(snapshot)) {
      ideaActivity.set(ideaId, { ...activity, ...ideaActivity.get(ideaId) })
    }
  }).catch((error) => console.warn('Could not load idea activity', error))
}
