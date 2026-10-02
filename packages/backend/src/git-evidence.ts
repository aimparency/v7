import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type IdeaCommitEvidence = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
};

export function parseIdeaCommitEvidence(stdout: string): IdeaCommitEvidence[] {
  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const fields = record.split('\x1f');
      if (fields.length !== 5) return [];
      const [hash, shortHash, subject, author, authoredAt] = fields as [string, string, string, string, string];
      return [{ hash, shortHash, subject, author, authoredAt }];
    });
}

export async function getIdeaCommitEvidence(
  repositoryPath: string,
  ideaId: string,
  limit = 20
): Promise<IdeaCommitEvidence[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  // Aimparency's commit convention uses the stable 8-character UUID prefix
  // (the same convention used by MCP reconciliation), while full UUIDs remain
  // valid because they contain that prefix too.
  const commitReference = ideaId.slice(0, 8);
  const { stdout } = await execFileAsync('git', [
    '-C', repositoryPath,
    'log',
    `--max-count=${boundedLimit}`,
    '--fixed-strings',
    `--grep=${commitReference}`,
    '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e'
  ]);

  return parseIdeaCommitEvidence(stdout);
}

export type IdeaStatusChange = {
  state: string;
  // The commit that introduced this status; the first entry's commit is the
  // one that first recorded the idea.
  commit: { hash: string; shortHash: string; subject: string; authoredAt: string };
};

async function gitStdout(repositoryPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function getRepositoryRoot(anyPathInRepository: string): Promise<string> {
  return (await gitStdout(anyPathInRepository, ['rev-parse', '--show-toplevel'])).trim();
}

// Status changes of an idea as recorded in git: walks the commits touching the
// idea's file (active or archived), oldest first, and keeps those whose
// committed status differs from the previous commit's.
export async function getIdeaStatusHistory(
  bowmanPath: string,
  ideaId: string,
  limit = 200
): Promise<IdeaStatusChange[]> {
  const repositoryPath = await getRepositoryRoot(bowmanPath);
  const bowmanRelative = path.relative(repositoryPath, bowmanPath);
  const ideaFiles = ['ideas', 'archived-ideas'].map((dir) => path.posix.join(bowmanRelative.split(path.sep).join('/'), dir, `${ideaId}.json`));

  const log = await gitStdout(repositoryPath, [
    'log', '--reverse', `--max-count=${Math.max(1, Math.min(limit, 1000))}`,
    '--format=%H%x1f%h%x1f%s%x1f%aI%x1e', '--', ...ideaFiles
  ]);
  const commits = log.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, shortHash, subject, authoredAt] = record.split('\x1f') as [string, string, string, string];
    return { hash, shortHash, subject, authoredAt };
  });

  const changes: IdeaStatusChange[] = [];
  for (const commit of commits) {
    let state: string | undefined;
    for (const file of ideaFiles) {
      try {
        state = JSON.parse(await gitStdout(repositoryPath, ['show', `${commit.hash}:${file}`]))?.status?.state;
        break;
      } catch {
        // Not present at this path in this commit (e.g. moved to archived-ideas, or deleted).
      }
    }
    if (state !== undefined && state !== changes[changes.length - 1]?.state) {
      changes.push({ state, commit });
    }
  }
  return changes;
}

export type CommitFileDiff = {
  path: string;
  // Unified diff hunk text for this file ('' for binary or mode-only changes).
  patch: string;
};

const MAX_PATCH_CHARS = 200_000;

export function parseCommitPatch(stdout: string): CommitFileDiff[] {
  return stdout
    .split(/^diff --git /m)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [header = '', ...rest] = chunk.split('\n');
      const newPath = /^\+\+\+ b\/(.*)$/m.exec(chunk)?.[1];
      const headerPath = / b\/(.*)$/.exec(header)?.[1] ?? header;
      const hunkStart = rest.findIndex((line) => line.startsWith('@@'));
      const patch = hunkStart < 0 ? '' : rest.slice(hunkStart).join('\n').trimEnd();
      return {
        path: newPath && newPath !== '/dev/null' ? newPath : headerPath,
        patch: patch.length > MAX_PATCH_CHARS ? `${patch.slice(0, MAX_PATCH_CHARS)}\n… (truncated)` : patch
      };
    });
}

export async function getCommitDiff(anyPathInRepository: string, hash: string): Promise<CommitFileDiff[]> {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Invalid commit hash');
  const repositoryPath = await getRepositoryRoot(anyPathInRepository);
  // First-parent diff; for the root commit git show diffs against the empty tree.
  return parseCommitPatch(await gitStdout(repositoryPath, ['show', '--format=', '--patch', '-M', hash]));
}
