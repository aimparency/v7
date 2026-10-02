import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAimStatusHistory, getCommitDiff, parseAimCommitEvidence } from './git-evidence.js';

describe('parseAimCommitEvidence', () => {
  it('parses Git log records used by the idea evidence query', () => {
    const evidence = parseAimCommitEvidence(
      '0123456789012345678901234567890123456789\x1f01234567\x1ffeat: realize idea abc-123\x1fTest User\x1f2026-07-21T18:00:00+02:00\x1e'
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0].subject).toBe('feat: realize idea abc-123');
    expect(evidence[0].shortHash).toBe('01234567');
  });

  it('preserves empty history as no implementation evidence', () => {
    expect(parseAimCommitEvidence('')).toEqual([]);
  });
});

describe('idea status history and commit diffs', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });

  it('reports each committed status change once, following the idea into archived-ideas', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-history-'));
    git(repo, 'init', '-q')
    const ideaId = '11111111-2222-3333-4444-555555555555';
    const bowman = path.join(repo, '.bowman');
    const write = (dir: string, state: string, text = 'Idea') => {
      fs.mkdirSync(path.join(bowman, dir), { recursive: true });
      fs.writeFileSync(path.join(bowman, dir, `${ideaId}.json`), JSON.stringify({ id: ideaId, text, status: { state } }));
    };
    const commit = (message: string) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', message); };

    write('ideas', 'open'); commit('create');
    fs.writeFileSync(path.join(repo, 'code.ts'), 'export const x = 1\n');
    write('ideas', 'done'); commit('implement');
    write('ideas', 'done', 'Renamed'); commit('rename only');
    fs.rmSync(path.join(bowman, 'ideas'), { recursive: true });
    write('archived-ideas', 'archived'); commit('archive');

    const history = await getAimStatusHistory(bowman, ideaId);
    expect(history.map((change) => [change.state, change.commit.subject])).toEqual([
      ['open', 'create'], ['done', 'implement'], ['archived', 'archive']
    ]);

    const diff = await getCommitDiff(bowman, history[1]!.commit.hash);
    expect(diff.map((file) => file.path).sort()).toEqual(['.bowman/ideas/11111111-2222-3333-4444-555555555555.json', 'code.ts']);
    expect(diff.find((file) => file.path === 'code.ts')!.patch).toContain('+export const x = 1');
  });

  it('rejects anything that is not a commit hash', async () => {
    await expect(getCommitDiff(os.tmpdir(), '--output=/tmp/x')).rejects.toThrow('Invalid commit hash');
  });
});
