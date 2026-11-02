import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { changeEventsFor, pullFastForward } from './hosted-git-sync';

// upstream (bare) <- author pushes; server is a clone that follows it.
let root = '';
let author = '';
let server = '';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim();
const serverBowman = () => path.join(server, '.bowman');

async function push(file: string, content: unknown) {
  await fs.outputJson(path.join(author, '.bowman', file), content);
  git(author, 'add', '-A');
  git(author, 'commit', '-qm', `change ${file}`);
  git(author, 'push', '-q');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-git-sync-'));
  const upstream = path.join(root, 'upstream.git');
  author = path.join(root, 'author');
  server = path.join(root, 'server');
  git(root, 'init', '-q', '--bare', '-b', 'main', upstream);
  git(root, 'clone', '-q', upstream, author);
  await fs.outputJson(path.join(author, '.bowman', 'meta.json'), { name: 'p' });
  await fs.outputJson(path.join(author, '.bowman', 'ideas', 'gone.json'), { id: 'gone' });
  await fs.outputFile(path.join(author, 'src', 'code.ts'), 'export {}');
  git(author, 'add', '-A');
  git(author, 'commit', '-qm', 'init');
  git(author, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', upstream, server);
});

afterEach(async () => {
  await fs.remove(root);
});

test('fast-forwards to pushed commits and reports the changed graph files as change events', async () => {
  assert.deepEqual(await pullFastForward(serverBowman()), { state: 'unchanged' });

  await fs.remove(path.join(author, '.bowman', 'ideas', 'gone.json'));
  await fs.outputFile(path.join(author, 'src', 'code.ts'), 'export const x = 1');
  await push('ideas/new.json', { id: 'new' });
  await push('phases/p1.json', { id: 'p1' });

  const outcome = await pullFastForward(serverBowman());
  assert.equal(outcome.state, 'updated');
  if (outcome.state !== 'updated') return;
  assert.deepEqual([...outcome.changedPaths].sort(), ['ideas/gone.json', 'ideas/new.json', 'phases/p1.json']);
  assert.deepEqual(await fs.readJson(path.join(serverBowman(), 'ideas', 'new.json')), { id: 'new' });

  const events = await changeEventsFor(serverBowman(), outcome.changedPaths);
  assert.deepEqual(
    events.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { type: 'idea', id: 'gone', projectPath: serverBowman(), deleted: true },
      { type: 'idea', id: 'new', projectPath: serverBowman() },
      { type: 'phase', id: 'p1', projectPath: serverBowman() },
    ],
  );
});

test('waits while the server has uncommitted graph edits, and pulls once they are committed', async () => {
  await fs.outputJson(path.join(serverBowman(), 'ideas', 'local.json'), { id: 'local' });
  await push('ideas/new.json', { id: 'new' });

  assert.deepEqual(await pullFastForward(serverBowman()), { state: 'uncommitted-edits' });
  assert.equal(await fs.pathExists(path.join(serverBowman(), 'ideas', 'new.json')), false);

  await fs.remove(path.join(serverBowman(), 'ideas', 'local.json'));
  assert.equal((await pullFastForward(serverBowman())).state, 'updated');
});

test('never merges diverged history and reports a missing upstream', async () => {
  await fs.outputJson(path.join(serverBowman(), 'ideas', 'server.json'), { id: 'server' });
  git(server, 'add', '-A');
  git(server, 'commit', '-qm', 'server-side commit');
  await push('ideas/new.json', { id: 'new' });
  const head = git(server, 'rev-parse', 'HEAD');

  assert.deepEqual(await pullFastForward(serverBowman()), { state: 'diverged' });
  assert.equal(git(server, 'rev-parse', 'HEAD'), head);

  git(server, 'checkout', '-q', '-b', 'local-only');
  assert.deepEqual(await pullFastForward(serverBowman()), { state: 'no-upstream' });
});

test('maps meta.json to a project event and ignores other files', async () => {
  const events = await changeEventsFor(serverBowman(), ['meta.json', 'ideas/notes.txt', '.gitignore']);
  assert.deepEqual(events, [{ type: 'project', id: 'meta', projectPath: serverBowman() }]);
});
