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

async function git(args: string[], options: { cwd?: string; allowFileUrls: boolean }) {
  return run('git', args, {
    cwd: options.cwd,
    timeout: GIT_TIMEOUT_MS,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0', // fail instead of waiting for a password nobody can type
      GIT_ALLOW_PROTOCOL: options.allowFileUrls ? 'https:http:ssh:file' : 'https:http:ssh'
    }
  });
}

/** Clones or refreshes `url` and returns the read-only project root. */
export async function openGitRepository(
  url: string,
  { cacheRoot = defaultGitCacheRoot(), allowFileUrls = false } = {}
): Promise<string> {
  const location = gitRepositoryLocation(url, { allowFileUrls });
  if (!location) throw new Error(`Not a Git URL Aimparency can open: ${url}`);
  const projectRoot = path.join(cacheRoot, ...location);
  const options = { allowFileUrls };

  const cloned = await fs.pathExists(path.join(projectRoot, '.git'))
    && (await git(['remote', 'get-url', 'origin'], { ...options, cwd: projectRoot }).then(({ stdout }) => stdout.trim() === url.trim(), () => false));
  try {
    if (cloned) {
      await git(['fetch', '--depth', '1', '--no-tags', 'origin'], { ...options, cwd: projectRoot });
      await git(['reset', '--hard', 'FETCH_HEAD'], { ...options, cwd: projectRoot });
    } else {
      await fs.remove(projectRoot);
      await fs.ensureDir(path.dirname(projectRoot));
      await git(['clone', '--depth', '1', '--no-tags', '--filter=blob:none', '--sparse', '--', url.trim(), projectRoot], options);
      await git(['sparse-checkout', 'set', AIMPARENCY_DIR_NAME], { ...options, cwd: projectRoot });
    }
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`Could not ${cloned ? 'update' : 'clone'} ${url}: ${stderr || (error as Error).message}`);
  }

  const bowmanPath = path.join(projectRoot, AIMPARENCY_DIR_NAME);
  if (!(await fs.pathExists(bowmanPath))) {
    await fs.remove(projectRoot);
    throw new Error(`${url} has no ${AIMPARENCY_DIR_NAME} directory, so it holds no Aimparency project.`);
  }
  await fs.ensureFile(path.join(bowmanPath, READ_ONLY_MARKER));
  return projectRoot;
}
