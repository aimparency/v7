// Opening someone else's project from a Git URL: a shallow, sparse clone of
// just its .bowman directory into a per-user cache, marked read-only. Reopening
// fetches the latest commit. Plain git only: no host API, no tokens; private
// repositories work exactly when the user's own git credentials allow it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { AIMPARENCY_DIR_NAME, gitRepositoryLocation } from 'shared';
import { READ_ONLY_MARKER } from 'shared/bowman-migration';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;

export function defaultGitCacheRoot(): string {
  if (process.env.AIMPARENCY_GIT_CACHE) return process.env.AIMPARENCY_GIT_CACHE;
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheHome, 'aimparency', 'repos');
}

// The person at this machine opens a URL with their own git setup and credentials.
function ownGitEnv(allowFileUrls: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0', // fail instead of waiting for a password nobody can type
    GIT_ALLOW_PROTOCOL: allowFileUrls ? 'https:http:ssh:file' : 'https:http:ssh'
  };
}

const git = (args: string[], env: NodeJS.ProcessEnv, cwd?: string) => run('git', args, { cwd, timeout: GIT_TIMEOUT_MS, env });

const gitReason = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || (error as Error).message;

/** A shallow, sparse clone of just the .bowman of `url` into `projectRoot` (replacing what is there). */
export async function cloneBowman(url: string, projectRoot: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await fs.remove(projectRoot);
    await fs.ensureDir(path.dirname(projectRoot));
    await git(['clone', '--depth', '1', '--no-tags', '--filter=blob:none', '--sparse', '--', url.trim(), projectRoot], env);
    await git(['sparse-checkout', 'set', AIMPARENCY_DIR_NAME], env, projectRoot);
  } catch (error) {
    await fs.remove(projectRoot);
    throw new Error(`Could not clone ${url}: ${gitReason(error)}`);
  }
  if (!(await fs.pathExists(path.join(projectRoot, AIMPARENCY_DIR_NAME)))) {
    await fs.remove(projectRoot);
    throw new Error(`${url} has no ${AIMPARENCY_DIR_NAME} directory, so it holds no Aimparency space.`);
  }
}

/**
 * Brings a clone nobody edits to the remote's latest commit, whatever happened
 * there (also a rewritten history). Returns the changed files inside .bowman,
 * relative to it; empty when nothing changed.
 */
export async function refreshBowmanClone(projectRoot: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const head = async (ref: string) => (await git(['rev-parse', ref], env, projectRoot)).stdout.trim();
  try {
    const from = await head('HEAD');
    await git(['fetch', '--depth', '1', '--no-tags', 'origin'], env, projectRoot);
    const to = await head('FETCH_HEAD');
    if (from === to) return [];
    await git(['reset', '--hard', 'FETCH_HEAD'], env, projectRoot);
    const { stdout } = await git(['diff', '--name-only', from, to, '--', AIMPARENCY_DIR_NAME], env, projectRoot);
    return stdout.split('\n').filter(Boolean).map(file => path.relative(AIMPARENCY_DIR_NAME, file));
  } catch (error) {
    throw new Error(`Could not update ${projectRoot}: ${gitReason(error)}`);
  }
}

/** Clones or refreshes `url` and returns the read-only project root. */
export async function openGitRepository(
  url: string,
  { cacheRoot = defaultGitCacheRoot(), allowFileUrls = false } = {}
): Promise<string> {
  const location = gitRepositoryLocation(url, { allowFileUrls });
  if (!location) throw new Error(`Not a Git URL Aimparency can open: ${url}`);
  const projectRoot = path.join(cacheRoot, ...location);
  const env = ownGitEnv(allowFileUrls);

  const cloned = await fs.pathExists(path.join(projectRoot, '.git'))
    && (await git(['remote', 'get-url', 'origin'], env, projectRoot).then(({ stdout }) => stdout.trim() === url.trim(), () => false));
  if (cloned) await refreshBowmanClone(projectRoot, env).catch(() => cloneBowman(url, projectRoot, env));
  else await cloneBowman(url, projectRoot, env);

  await fs.ensureFile(path.join(projectRoot, AIMPARENCY_DIR_NAME, READ_ONLY_MARKER));
  return projectRoot;
}
