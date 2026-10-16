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
  | { isRepository: true; repositoryPath: string; lastCommitAt: number | null; changes: WorkingTreeChange[] };

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

export async function readWorkingTreeStatus(directory: string): Promise<WorkingTreeStatus> {
  let repositoryPath: string;
  try {
    repositoryPath = (await git(directory, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return { isRepository: false };
  }
  const [status, lastCommit] = await Promise.all([
    git(repositoryPath, ['status', '--porcelain', '-z', '--untracked-files=all']),
    git(repositoryPath, ['log', '-1', '--format=%ct']).catch(() => '') // no commit yet
  ]);
  const seconds = Number(lastCommit.trim());
  return { isRepository: true, repositoryPath, lastCommitAt: seconds ? seconds * 1000 : null, changes: parsePorcelainStatus(status) };
}

// Commits exactly the given changed paths. Agents share the working tree, so
// nothing else is staged, and what someone else had staged stays staged.
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
