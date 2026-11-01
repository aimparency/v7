import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { accessStrength, addAccess, type IdeaAccessKind, type IdeaActivity, type IdeaActivityEvent, type IdeaActivitySnapshot } from 'shared';
import { onChange } from './change-events.js';
import { currentOrigin } from './change-origin.js';
import { normalizeProjectPath } from './project-path.js';

// Who touched which idea lately. Kept in memory and saved, debounced, to the
// project's gitignored runtime area, so the dev backend's restarts on every
// source change don't turn the graph dark while agents work. Live state, not
// history: it stays out of git.
const activityByProject = new Map<string, Map<string, IdeaActivity>>();
const ACTIVITY_FILE = path.join('runtime', 'idea-activity.json');
const SAVE_DELAY_MS = 2000;
// Below this strength an access no longer shows, so it is not worth saving.
const FADED_STRENGTH = 0.005;
const pendingSaves = new Map<string, NodeJS.Timeout>();

export function loadIdeaActivity(projectPath: string): Map<string, IdeaActivity> {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(projectPath, ACTIVITY_FILE), 'utf8'))));
  } catch {
    return new Map();
  }
}

// Drops what has faded from view (in place), then writes the rest.
export function saveIdeaActivity(projectPath: string, activity: Map<string, IdeaActivity>, now = Date.now()): void {
  for (const [ideaId, kinds] of activity) {
    const visible = Object.entries(kinds).filter(([kind, level]) => accessStrength(kind as IdeaAccessKind, level, now) >= FADED_STRENGTH);
    if (visible.length) activity.set(ideaId, Object.fromEntries(visible));
    else activity.delete(ideaId);
  }
  const file = path.join(projectPath, ACTIVITY_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(activity)));
}

function projectActivity(projectPath: string): Map<string, IdeaActivity> {
  let activity = activityByProject.get(projectPath);
  if (!activity) activityByProject.set(projectPath, activity = loadIdeaActivity(projectPath));
  return activity;
}

function flush(projectPath: string): void {
  clearTimeout(pendingSaves.get(projectPath));
  pendingSaves.delete(projectPath);
  saveIdeaActivity(projectPath, projectActivity(projectPath));
}

function scheduleSave(projectPath: string): void {
  // Only real projects: never create a .bowman directory as a side effect.
  if (pendingSaves.has(projectPath) || !fs.existsSync(projectPath)) return;
  pendingSaves.set(projectPath, setTimeout(() => flush(projectPath), SAVE_DELAY_MS).unref());
}

// A restart (tsx watch) ends the process; save what is still pending.
process.once('exit', () => {
  for (const projectPath of [...pendingSaves.keys()]) flush(projectPath);
});
const emitter = new EventEmitter();
// Numbers every access, so clients can merge a snapshot with live events
// without counting an access twice (activity adds up, see shared/idea-activity).
let seq = 0;

export function recordIdeaAccess(rawProjectPath: string, ideaIds: string[], kind: IdeaAccessKind, at = Date.now()): void {
  if (ideaIds.length === 0) return;
  const projectPath = normalizeProjectPath(rawProjectPath);
  const activity = projectActivity(projectPath);
  for (const ideaId of ideaIds) activity.set(ideaId, addAccess(activity.get(ideaId), kind, at));
  scheduleSave(projectPath);
  emitter.emit('access', { projectPath, ideaIds, kind, at, seq: ++seq } satisfies IdeaActivityEvent);
}

// Contains exactly the accesses up to and including number `seq`.
export function ideaActivitySnapshot(rawProjectPath: string): IdeaActivitySnapshot {
  return { seq, ideas: Object.fromEntries(projectActivity(normalizeProjectPath(rawProjectPath))) };
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
