import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'fs-extra';
import { emitChange, type ChangeEvent } from './change-events.js';
import { readWorkingTreeStatus } from './git-working-tree.js';
import { forgetProjectChecks } from './storage/project.js';
import { spaceBowmanPath, listSpaces, type Space } from './spaces/registry.js';
import { spaceGitEnv } from './spaces/remote-git.js';
import { refreshBowmanClone } from './git-repository-cache.js';

// A server for other people follows the git remotes of its spaces: what is
// pushed shows up without anyone logging in to the server. It only
// fast-forwards, never commits or pushes, and waits while a space's .bowman has
// uncommitted edits (they are committed in the UI).

const execFileAsync = promisify(execFile);
const OWN_GIT: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

export type PullOutcome =
  | { state: 'updated'; from: string; to: string; changedPaths: string[] }
  | { state: 'unchanged' }
  | { state: 'uncommitted-edits' }
  | { state: 'diverged' }
  | { state: 'no-upstream' }
  | { state: 'failed'; reason: string };

/** `bowmanPath` is the project's .bowman directory; `env` is what git may use to reach the remote. */
export async function pullFastForward(bowmanPath: string, env: NodeJS.ProcessEnv = OWN_GIT): Promise<PullOutcome> {
  const git = async (cwd: string, args: string[]) =>
    (await execFileAsync('git', ['-C', cwd, ...args], { env, timeout: 120_000 })).stdout.trim();
  try {
    const status = await readWorkingTreeStatus(bowmanPath);
    if (!status.isRepository) return { state: 'failed', reason: 'not a git repository' };
    if (status.changes.length > 0) return { state: 'uncommitted-edits' };
    const root = status.repositoryPath;
    try {
      await git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']);
    } catch {
      return { state: 'no-upstream' };
    }
    await git(root, ['fetch', '--quiet']);
    const [from, to] = await Promise.all([git(root, ['rev-parse', 'HEAD']), git(root, ['rev-parse', '@{upstream}'])]);
    if (from === to) return { state: 'unchanged' };
    try {
      await git(root, ['merge-base', '--is-ancestor', 'HEAD', '@{upstream}']);
    } catch {
      return { state: 'diverged' }; // also when only the server is ahead: nothing to take
    }
    await git(root, ['merge', '--ff-only', '--quiet', '@{upstream}']);
    const relative = path.relative(root, bowmanPath) || '.';
    const changed = await git(root, ['diff', '--name-only', from, to, '--', relative]);
    const changedPaths = changed ? changed.split('\n').map(file => path.relative(relative, file)) : [];
    return { state: 'updated', from, to, changedPaths };
  } catch (error) {
    return { state: 'failed', reason: error instanceof Error ? error.message.split('\n')[0]! : String(error) };
  }
}

// Changed .bowman files as the events storage writes would have emitted, so
// open browsers refresh and values recalculate. Deleted files are reported
// deleted; clients load the rest themselves.
export async function changeEventsFor(bowmanPath: string, changedPaths: string[]): Promise<ChangeEvent[]> {
  const events: ChangeEvent[] = [];
  for (const file of changedPaths) {
    const [directory, name] = file.split('/');
    const type = directory === 'ideas' ? 'idea' : directory === 'phases' ? 'phase' : file === 'meta.json' ? 'project' : null;
    if (!type) continue;
    const id = type === 'project' ? 'meta' : name?.replace(/\.json$/, '');
    if (!id || (type !== 'project' && !name!.endsWith('.json'))) continue;
    const deleted = !(await fs.pathExists(path.join(bowmanPath, file)));
    events.push({ type, id, projectPath: bowmanPath, ...(deleted ? { deleted } : {}) });
  }
  return events;
}

export function followGitRemotes(intervalSeconds: number): () => void {
  if (intervalSeconds <= 0) return () => {};
  const lastStates = new Map<string, string>();
  let running = false;
  const follow = async (space: Space) => {
    const bowmanPath = spaceBowmanPath(space);
    const env = await spaceGitEnv(space);
    // A remote space without a key is edited by nobody here: it takes whatever the remote holds.
    const outcome: PullOutcome = space.remote && !space.remote.key
      ? await refreshBowmanClone(space.path, env).then(
        (changedPaths): PullOutcome => changedPaths.length ? { state: 'updated', from: '', to: '', changedPaths } : { state: 'unchanged' },
        (error): PullOutcome => ({ state: 'failed', reason: error instanceof Error ? error.message.split('\n')[0]! : String(error) }))
      : await pullFastForward(bowmanPath, env);
    if (outcome.state === 'updated') {
      forgetProjectChecks(); // a pulled newer data model gets migrated on next use
      for (const event of await changeEventsFor(bowmanPath, outcome.changedPaths)) emitChange(event);
      console.log(`[git-sync] ${space.slug}: pulled ${outcome.changedPaths.length} space files`);
    } else if (outcome.state !== lastStates.get(space.slug) && outcome.state !== 'unchanged' && outcome.state !== 'no-upstream') {
      console.log(`[git-sync] ${space.slug}: not pulling: ${outcome.state === 'failed' ? outcome.reason : outcome.state}`);
    }
    lastStates.set(space.slug, outcome.state);
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // One after the other: a server holds many spaces, and none is urgent.
      for (const space of listSpaces()) {
        await follow(space).catch(error => console.warn(`[git-sync] ${space.slug}:`, error instanceof Error ? error.message : error));
      }
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
