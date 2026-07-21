import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AimCommitEvidence = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
};

export function parseAimCommitEvidence(stdout: string): AimCommitEvidence[] {
  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, subject, author, authoredAt] = record.split('\x1f');
      return { hash, shortHash, subject, author, authoredAt };
    });
}

export async function getAimCommitEvidence(
  repositoryPath: string,
  aimId: string,
  limit = 20
): Promise<AimCommitEvidence[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  // Aimparency's commit convention uses the stable 8-character UUID prefix
  // (the same convention used by MCP reconciliation), while full UUIDs remain
  // valid because they contain that prefix too.
  const commitReference = aimId.slice(0, 8);
  const { stdout } = await execFileAsync('git', [
    '-C', repositoryPath,
    'log',
    `--max-count=${boundedLimit}`,
    '--fixed-strings',
    `--grep=${commitReference}`,
    '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e'
  ]);

  return parseAimCommitEvidence(stdout);
}
