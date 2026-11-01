import { EventEmitter } from 'node:events';
import { addAccess, type IdeaAccessKind, type IdeaActivity, type IdeaActivityEvent, type IdeaActivitySnapshot } from 'shared';
import { onChange } from './change-events.js';
import { currentOrigin } from './change-origin.js';
import { normalizeProjectPath } from './project-path.js';

// Who touched which idea lately, in memory only: a restart starts dark.
const activityByProject = new Map<string, Map<string, IdeaActivity>>();
const emitter = new EventEmitter();
// Numbers every access, so clients can merge a snapshot with live events
// without counting an access twice (activity adds up, see shared/idea-activity).
let seq = 0;

export function recordIdeaAccess(rawProjectPath: string, ideaIds: string[], kind: IdeaAccessKind, at = Date.now()): void {
  if (ideaIds.length === 0) return;
  const projectPath = normalizeProjectPath(rawProjectPath);
  let activity = activityByProject.get(projectPath);
  if (!activity) activityByProject.set(projectPath, activity = new Map());
  for (const ideaId of ideaIds) activity.set(ideaId, addAccess(activity.get(ideaId), kind, at));
  emitter.emit('access', { projectPath, ideaIds, kind, at, seq: ++seq } satisfies IdeaActivityEvent);
}

// Contains exactly the accesses up to and including number `seq`.
export function ideaActivitySnapshot(rawProjectPath: string): IdeaActivitySnapshot {
  return { seq, ideas: Object.fromEntries(activityByProject.get(normalizeProjectPath(rawProjectPath)) ?? []) };
}

export function onIdeaAccess(listener: (event: IdeaActivityEvent) => void): () => void {
  emitter.on('access', listener);
  return () => emitter.off('access', listener);
}

const statusOf = (record: unknown) => (record as { status?: { state?: string } } | null)?.status?.state;

// Writes need no reporting: every idea change passes here. Requests from the UI
// carry a client id; the MCP server's don't, so those are the agents'.
export function ideaChangeAccessKind(origin: string | undefined, previous: unknown, next: unknown): IdeaAccessKind {
  if (origin !== undefined) return 'manualEdit';
  return previous && statusOf(previous) !== statusOf(next) ? 'statusChange' : 'write';
}

onChange((event) => {
  if (event.type !== 'idea' || event.deleted) return;
  recordIdeaAccess(event.projectPath, [event.id], ideaChangeAccessKind(currentOrigin(), event.previous, event.entity));
});
