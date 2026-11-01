import { addAccess, type IdeaActivity, type IdeaActivityEvent } from 'shared'
import { trpc } from '../trpc'

// Recent agent and manual access per idea, for the graph's Activity color
// mode. A plain map, not reactive state: the renderer reads it every frame.
export const ideaActivity = new Map<string, IdeaActivity>()

let subscription: { unsubscribe: () => void } | null = null

function apply({ ideaIds, kind, at }: IdeaActivityEvent) {
  for (const ideaId of ideaIds) ideaActivity.set(ideaId, addAccess(ideaActivity.get(ideaId), kind, at))
}

export function followIdeaActivity(projectPath: string) {
  subscription?.unsubscribe()
  ideaActivity.clear()
  // Accesses add up, so none may count twice: hold live events until the
  // snapshot arrives, then replay only those it doesn't contain yet.
  let waiting: IdeaActivityEvent[] | null = []
  const current = subscription = trpc.activity.onAccess.subscribe({ projectPath }, {
    onData: (event) => { if (waiting) waiting.push(event); else apply(event) },
    onError: (error) => console.warn('Idea activity feed stopped', error)
  })
  void trpc.activity.snapshot.query({ projectPath }).then((snapshot) => {
    if (subscription !== current) return // another project was opened meanwhile
    for (const [ideaId, activity] of Object.entries(snapshot.ideas)) ideaActivity.set(ideaId, activity)
    for (const event of waiting!) if (event.seq > snapshot.seq) apply(event)
  }).catch((error) => console.warn('Could not load idea activity', error))
    .finally(() => { waiting = null })
}
