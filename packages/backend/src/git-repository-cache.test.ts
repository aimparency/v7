import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { gitRepositoryLocation } from 'shared';
import { READ_ONLY_MARKER } from 'shared/bowman-migration';
import { openGitRepository } from './git-repository-cache';

let root = '';
let source = '';
let cacheRoot = '';
const options = () => ({ cacheRoot, allowFileUrls: true });
const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'pipe' });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-git-cache-'));
  source = path.join(root, 'source');
  cacheRoot = path.join(root, 'cache');
  await fs.ensureDir(path.join(source, '.bowman', 'ideas'));
  await fs.writeJson(path.join(source, '.bowman', 'meta.json'), { name: 'shared project', color: '#336699', dataModelVersion: 4 });
  await fs.writeFile(path.join(source, 'big-unrelated-file.bin'), 'x'.repeat(10_000));
  await fs.ensureDir(path.join(source, 'src'));
  await fs.writeFile(path.join(source, 'src', 'code.ts'), 'export {}');
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
});

afterEach(async () => {
  await fs.remove(root);
});

test('clones only the .bowman directory, read-only, and picks up new commits on reopen', async () => {
  const url = `file://${source}`;
  const projectRoot = await openGitRepository(url, options());

  assert.ok(projectRoot.startsWith(cacheRoot));
  assert.deepEqual(await fs.readJson(path.join(projectRoot, '.bowman', 'meta.json')), { name: 'shared project', color: '#336699', dataModelVersion: 4 });
  assert.ok(await fs.pathExists(path.join(projectRoot, '.bowman', READ_ONLY_MARKER)));
  assert.equal(await fs.pathExists(path.join(projectRoot, 'src', 'code.ts')), false, 'unrelated directories are not checked out');

  await fs.writeJson(path.join(source, '.bowman', 'meta.json'), { name: 'renamed upstream', color: '#336699', dataModelVersion: 4 });
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'rename');

  assert.equal(await openGitRepository(url, options()), projectRoot);
  assert.equal((await fs.readJson(path.join(projectRoot, '.bowman', 'meta.json'))).name, 'renamed upstream');
  assert.ok(await fs.pathExists(path.join(projectRoot, '.bowman', READ_ONLY_MARKER)));
});

test('a repository without .bowman is reported and not kept', async () => {
  await fs.remove(path.join(source, '.bowman'));
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'no project');
  await assert.rejects(openGitRepository(`file://${source}`, options()), /has no \.bowman directory/);
  assert.equal(await fs.pathExists(path.join(cacheRoot, ...gitRepositoryLocation(`file://${source}`, { allowFileUrls: true })!)), false);
});

test('an unreachable repository fails with git\'s reason instead of hanging', async () => {
  await assert.rejects(openGitRepository(`file://${path.join(root, 'missing')}`, options()), /Could not clone/);
});

test('only https and ssh URLs are accepted; other transports and option-like paths are refused', () => {
  assert.deepEqual(gitRepositoryLocation('https://github.com/aimparency/v7.git'), ['github.com', 'aimparency', 'v7']);
  assert.deepEqual(gitRepositoryLocation('git@github.com:aimparency/v7.git'), ['github.com', 'aimparency', 'v7']);
  assert.deepEqual(gitRepositoryLocation('ssh://git@codeberg.org/someone/plans'), ['codeberg.org', 'someone', 'plans']);
  // Dot segments are resolved by URL parsing, so a location cannot leave the cache.
  assert.deepEqual(gitRepositoryLocation('https://host/../../etc'), ['host', 'etc']);
  for (const refused of ['ext::sh -c touch% /tmp/pwned', 'file:///etc', '/home/felix/project', '-oProxyCommand=evil', 'https://host/-upload-pack=evil']) {
    assert.equal(gitRepositoryLocation(refused), null, refused);
  }
});
