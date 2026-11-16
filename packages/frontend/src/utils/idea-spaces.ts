import { observable } from '@trpc/server/observable'
import type { TRPCLink } from '@trpc/client'
import type { AppRouter } from 'backend'
import { remoteSpace, remoteUntyped } from './remote-trpc'

// Spaces opened in place that the viewer may write keep their ideas in the
// same store as the open space: the UI treats them alike. What a request does
// to such an idea goes to that idea's space. This map says which space an
// idea belongs to: its slug on this server, or its whole address
// (https://<server>/spaces/<slug>) on another one, which gets the request
// itself; the open space's own ideas are not in it.
const spaces = new Map<string, string>()

export function setIdeaSpace(ideaId: string, graph: string | null) {
  if (graph) spaces.set(ideaId, graph)
  else spaces.delete(ideaId)
}

export function clearIdeaSpaces() {
  spaces.clear()
}

export class CrossSpaceError extends Error {
  constructor() {
    super('Ideas of two spaces are not connected one by one: drop onto the space instead, and it supports the idea as a whole.')
    this.name = 'CrossSpaceError'
  }
}

// The ideas a request names, wherever an input names one.
function ideaIdsOf(input: Record<string, unknown>): string[] {
  const ids: string[] = []
  for (const key of ['ideaId', 'parentIdeaId', 'childIdeaId', 'inheritColorFrom']) {
    if (typeof input[key] === 'string') ids.push(input[key] as string)
  }
  if (Array.isArray(input.ideaIds)) ids.push(...input.ideaIds.filter((id): id is string => typeof id === 'string'))
  return ids
}

/** The space a request about these ideas goes to: null for the open space, undefined when they belong to different spaces. */
export function spaceOfIdeas(ids: string[]): string | null | undefined {
  const targets = new Set(ids.map(id => spaces.get(id) ?? null))
  if (targets.size > 1) return undefined
  return targets.size === 1 ? [...targets][0]! : null
}

export const ideaSpaceLink: TRPCLink<AppRouter> = () => ({ next, op }) => {
  const input = op.input as Record<string, unknown> | undefined
  if (op.type === 'subscription' || !input || typeof input !== 'object' || typeof input.graph !== 'string' || spaces.size === 0) return next(op)
  const target = spaceOfIdeas(ideaIdsOf(input))
  if (target === undefined) {
    return observable((observer) => {
      observer.error(new CrossSpaceError() as never)
    })
  }
  if (target === null) return next(op)
  const remote = remoteSpace(target)
  if (!remote) return next({ ...op, input: { ...input, graph: target } })
  return observable((observer) => {
    const client = remoteUntyped(remote.origin)
    const request = op.type === 'mutation'
      ? client.mutation(op.path, { ...input, graph: remote.graph })
      : client.query(op.path, { ...input, graph: remote.graph })
    request.then(
      (data) => { observer.next({ result: { type: 'data', data } } as never); observer.complete() },
      (error) => observer.error(error)
    )
  })
}
