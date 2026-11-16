import type { TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter } from 'backend'
import { mutationActivity } from './mutation-activity'

// Tells the undo history when a mutation starts and ends, whichever server it goes to.
export const mutationTrackingLink: TRPCLink<AppRouter> = () => ({ next, op }) => {
  if (op.type !== 'mutation') return next(op)
  return observable((observer) => {
    mutationActivity.onStart(op.path)
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      mutationActivity.onEnd(op.path)
    }
    const subscription = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (error) => { end(); observer.error(error) },
      complete: () => { end(); observer.complete() }
    })
    return () => { end(); subscription.unsubscribe() }
  })
}
