import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitPaths, parsePorcelainStatus, pushToUpstream, readWorkingTreeStatus } from './git-working-tree.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });

describe('git working tree', () => {
  it('parses porcelain records, skipping the origin of a rename', () => {
    expect(parsePorcelainStatus('R  new.ts\0old.ts\0?? a b.txt\0 M x\0')).toEqual([
      { code: 'R ', path: 'new.ts' },
      { code: '??', path: 'a b.txt' },
      { code: ' M', path: 'x' }
    ]);
  });

  it('reports a directory outside git as no repository', async () => {
    expect(await readWorkingTreeStatus(fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-')))).toEqual({ isRepository: false });
  });

  it('sees and commits only .bowman changes, including new and deleted files, and leaves the rest of the repository alone', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'working-tree-')));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.com');
    const bowman = path.join(repo, '.bowman');
    fs.mkdirSync(bowman);
    for (const name of ['.bowman/keep.json', '.bowman/gone.json', 'code.ts', 'staged.ts']) fs.writeFileSync(path.join(repo, name), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'start');

    fs.writeFileSync(path.join(bowman, 'keep.json'), 'two\n');
    fs.rmSync(path.join(bowman, 'gone.json'));
    fs.writeFileSync(path.join(bowman, 'new.json'), '{}\n');
    fs.writeFileSync(path.join(repo, 'code.ts'), 'two\n');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'untracked on purpose\n');
    fs.writeFileSync(path.join(repo, 'staged.ts'), 'someone else\n');
    git(repo, 'add', 'staged.ts');

    const before = await readWorkingTreeStatus(bowman);
    if (!before.isRepository) throw new Error('expected a repository');
    expect(before.repositoryPath).toBe(repo);
    expect(before.lastCommitAt).toBeGreaterThan(0);
    expect(before.changes.map(change => change.path).sort()).toEqual(['.bowman/gone.json', '.bowman/keep.json', '.bowman/new.json']);

    await commitPaths(bowman, ['.bowman/new.json', '.bowman/gone.json'], 'graph: new idea');

    expect(git(repo, 'show', '--name-only', '--format=%s', 'HEAD').trim().split('\n')).toEqual(['graph: new idea', '', '.bowman/gone.json', '.bowman/new.json']);
    expect(git(repo, 'status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([' M .bowman/keep.json', ' M code.ts', '?? notes.txt', 'M  staged.ts']);
    await expect(commitPaths(bowman, ['code.ts'], 'x')).rejects.toThrow(/Not changed/);
    await expect(commitPaths(bowman, ['notes.txt'], 'x')).rejects.toThrow(/Not changed/);
    await expect(commitPaths(bowman, ['.bowman/keep.json'], '  ')).rejects.toThrow(/message/);
  });

  it('counts unpushed commits, pushes them, and refuses when the remote moved on', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'working-tree-push-')));
    const upstream = path.join(root, 'upstream.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    git(root, 'init', '-q', '--bare', '-b', 'main', upstream);
    git(root, 'clone', '-q', upstream, repo);
    const bowman = path.join(repo, '.bowman');
    fs.mkdirSync(bowman);
    fs.writeFileSync(path.join(bowman, 'meta.json'), '{}\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'start');
    expect(await readWorkingTreeStatus(bowman)).toMatchObject({ ahead: null });
    await expect(pushToUpstream(bowman)).rejects.toThrow(/no upstream/);

    git(repo, 'push', '-q', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(repo, 'code.ts'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'code, made outside the dialog');
    expect(await readWorkingTreeStatus(bowman)).toMatchObject({ ahead: 1 });
    expect(await pushToUpstream(bowman)).toBe(1);
    expect(git(upstream, 'log', '-1', '--format=%s', 'main').trim()).toBe('code, made outside the dialog');
    expect(await pushToUpstream(bowman)).toBe(0);

    git(root, 'clone', '-q', upstream, other);
    fs.writeFileSync(path.join(other, 'theirs.ts'), 'x\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'theirs');
    git(other, 'push', '-q');
    fs.writeFileSync(path.join(bowman, 'meta.json'), '{"a":1}\n');
    await commitPaths(bowman, ['.bowman/meta.json'], 'ours');
    await expect(pushToUpstream(bowman)).rejects.toThrow(/pull them first/);
  });
});
