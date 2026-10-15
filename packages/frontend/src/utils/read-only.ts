import { observable } from '@trpc/server/observable'
import type { TRPCLink } from '@trpc/client'
import type { AppRouter } from 'backend'

// Projects the backend reported as not writable (project.getAccess), so edits
// are refused here, before any optimistic local change reaches the server.
const reasons = new Map<string, string>()

// Viewer state, not graph content: allowed on read-only projects.
const ALLOWED_MUTATIONS = new Set(['phase.setCursor', 'project.buildSearchIndex'])

const projectKey = (projectPath: string) => projectPath.replace(/\/+$/, '').replace(/\/\.bowman$/, '')

export function setProjectAccess(projectPath: string, reason: string | null) {
  if (reason) reasons.set(projectKey(projectPath), reason)
  else reasons.delete(projectKey(projectPath))
}

export class ReadOnlyProjectError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ReadOnlyProjectError'
  }
}

// Refused here or by the backend's write guard: either way the same reason.
export const isReadOnlyError = (error: unknown) =>
  error instanceof ReadOnlyProjectError || (error instanceof Error && /open read-only/.test(error.message))

export const readOnlyGuardLink: TRPCLink<AppRouter> = () => ({ next, op }) => {
  const projectPath = (op.input as { projectPath?: unknown } | undefined)?.projectPath
  const reason = op.type === 'mutation' && !ALLOWED_MUTATIONS.has(op.path) && typeof projectPath === 'string'
    ? reasons.get(projectKey(projectPath))
    : undefined
  if (!reason) return next(op)
  return observable((observer) => {
    observer.error(new ReadOnlyProjectError(reason) as never)
  })
}
