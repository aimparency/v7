import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const git = async (cwd: string, args: string[]) =>
  (await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;

export type WorkingTreeChange = {
  /** Repository-relative path. */
  path: string;
  /** Two-letter porcelain code: index state, then working-tree state ('??' untracked). */
  code: string;
};

export type WorkingTreeStatus =
  | { isRepository: false }
  | {
    isRepository: true;
    repositoryPath: string;
    lastCommitAt: number | null;
    changes: WorkingTreeChange[];
    /** Commits on the branch its upstream lacks; null without an upstream. */
    ahead: number | null;
  };

// `git status --porcelain -z`: "XY path\0", renames and copies followed by "origin\0".
export function parsePorcelainStatus(stdout: string): WorkingTreeChange[] {
  const tokens = stdout.split('\0');
  const changes: WorkingTreeChange[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.length < 4) continue;
    const code = token.slice(0, 2);
    changes.push({ code, path: token.slice(3) });
    if (code.includes('R') || code.includes('C')) index++; // skip the origin path
  }
  return changes;
}

// Only changes inside `directory` (the .bowman) count: the rest of the
// repository is someone else's work, untracked files there may be untracked
// on purpose. Porcelain paths stay repository-relative.
export async function readWorkingTreeStatus(directory: string): Promise<WorkingTreeStatus> {
  let repositoryPath: string;
  try {
    repositoryPath = (await git(directory, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return { isRepository: false };
  }
  const [status, lastCommit, ahead] = await Promise.all([
    git(directory, ['status', '--porcelain', '-z', '--untracked-files=all', '--', '.']),
    git(directory, ['log', '-1', '--format=%ct', '--', '.']).catch(() => ''), // no commit yet
    git(directory, ['rev-list', '--count', '@{upstream}..HEAD']).then(count => Number(count.trim()), () => null)
  ]);
  const seconds = Number(lastCommit.trim());
  return { isRepository: true, repositoryPath, lastCommitAt: seconds ? seconds * 1000 : null, changes: parsePorcelainStatus(status), ahead };
}

// Commits exactly the given changed paths inside `directory`. Agents share the
// working tree, so nothing else is staged, and what someone else had staged stays staged.
export async function commitPaths(directory: string, paths: string[], message: string): Promise<string> {
  const status = await readWorkingTreeStatus(directory);
  if (!status.isRepository) throw new Error('Not a git repository');
  const changed = new Set(status.changes.map(change => change.path));
  const unknown = paths.filter(path => !changed.has(path));
  if (unknown.length) throw new Error(`Not changed: ${unknown.join(', ')}`);
  if (!paths.length) throw new Error('Choose at least one file to commit');
  if (!message.trim()) throw new Error('Enter a commit message');
  await git(status.repositoryPath, ['add', '-A', '--', ...paths]);
  await git(status.repositoryPath, ['commit', '--only', '-m', message.trim(), '--', ...paths]);
  return (await git(status.repositoryPath, ['rev-parse', '--short', 'HEAD'])).trim();
}

// Pushes the branch to its upstream: the whole branch, so also commits made
// outside this dialog. Never prompts for credentials; a server needs them set up.
export async function pushToUpstream(directory: string): Promise<number> {
  const status = await readWorkingTreeStatus(directory);
  if (!status.isRepository) throw new Error('Not a git repository');
  if (status.ahead === null) throw new Error('This branch has no upstream to push to');
  if (status.ahead === 0) return 0;
  try {
    await execFileAsync('git', ['-C', status.repositoryPath, 'push', '--quiet'], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 120_000,
    });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '');
    if (/\[rejected\]|non-fast-forward|fetch first/.test(stderr)) throw new Error('The remote has commits this clone lacks: pull them first');
    throw new Error(stderr.split('\n').find(line => line.trim())?.replace(/^(fatal|error): /, '') ?? 'Push failed');
  }
  return status.ahead;
}
