import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getIdeaStatusHistory, getCommitDiff, parseIdeaCommitEvidence } from './git-evidence.js';

describe('parseIdeaCommitEvidence', () => {
  it('parses Git log records used by the idea evidence query', () => {
    const evidence = parseIdeaCommitEvidence(
      '0123456789012345678901234567890123456789\x1f01234567\x1ffeat: realize idea abc-123\x1fTest User\x1f2026-07-21T18:00:00+02:00\x1e'
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0].subject).toBe('feat: realize idea abc-123');
    expect(evidence[0].shortHash).toBe('01234567');
  });

  it('preserves empty history as no implementation evidence', () => {
    expect(parseIdeaCommitEvidence('')).toEqual([]);
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
    write('ideas', 'implemented'); commit('implement');
    write('ideas', 'implemented', 'Renamed'); commit('rename only');
    fs.rmSync(path.join(bowman, 'ideas'), { recursive: true });
    write('archived-ideas', 'archived'); commit('archive');

    const history = await getIdeaStatusHistory(bowman, ideaId);
    expect(history.map((change) => [change.state, change.commit.subject])).toEqual([
      ['open', 'create'], ['implemented', 'implement'], ['archived', 'archive']
    ]);

    const diff = await getCommitDiff(bowman, history[1]!.commit.hash);
    expect(diff.map((file) => file.path).sort()).toEqual(['.bowman/ideas/11111111-2222-3333-4444-555555555555.json', 'code.ts']);
    expect(diff.find((file) => file.path === 'code.ts')!.patch).toContain('+export const x = 1');
  });

  it('follows an idea across the aim→idea layout migration without a spurious status change', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-history-legacy-'));
    git(repo, 'init', '-q')
    const ideaId = '11111111-2222-3333-4444-666666666666';
    const bowman = path.join(repo, '.bowman');
    const write = (dir: string, record: object) => {
      fs.mkdirSync(path.join(bowman, dir), { recursive: true });
      fs.writeFileSync(path.join(bowman, dir, `${ideaId}.json`), JSON.stringify({ id: ideaId, text: 'Idea', ...record }));
    };
    const commit = (message: string) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', message); };

    write('aims', { status: { state: 'open' } }); commit('create (legacy)');
    write('aims', { status: { state: 'done' } }); commit('finish (legacy)');
    fs.rmSync(path.join(bowman, 'aims'), { recursive: true });
    write('ideas', { status: { state: 'implemented' } }); commit('migrate layout');
    write('ideas', { status: { state: 'review' } }); commit('reopen for review');

    const history = await getIdeaStatusHistory(bowman, ideaId);
    expect(history.map((change) => [change.state, change.commit.subject])).toEqual([
      ['open', 'create (legacy)'], ['implemented', 'finish (legacy)'], ['review', 'reopen for review']
    ]);
  });

  it('rejects anything that is not a commit hash', async () => {
    await expect(getCommitDiff(os.tmpdir(), '--output=/tmp/x')).rejects.toThrow('Invalid commit hash');
  });
});
