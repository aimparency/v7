// Deleting a space removes what its origin allows: the repository of a space
// created here, the clone of a remote one, nothing of a checkout but the
// server's entry. Gone for good, it leaves no offers and no token naming it.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { forgetServerFile, updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from '../auth/accounts';
import { addCheckout, DELETED_DAYS, listDeletedSpaces, listSpaces } from './registry';
import { purgeDeletedSpaces } from './deletion';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const later = () => Date.now() + DELETED_DAYS * 86_400_000;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-deletion-'));
  process.env.AIMPARENCY_SERVER_DIR = path.join(root, 'server');
  updateServerConfig({ login: 'accounts' });
});

afterEach(async () => {
  for (const space of [...listSpaces(), ...listDeletedSpaces()]) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const loggedIn = async (name: string) => {
  await accounts.createAccount(name, `${name} password`);
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

test('a space created here goes with its repository; of a checkout only the server\'s entry goes', async () => {
  const ana = await loggedIn('ana');
  const created = (await ana.spaces.create({ name: 'Made here' })).slug;
  const createdDirectory = listSpaces().find(space => space.slug === created)!.path;
  const repository = path.join(root, 'operator-repo');
  await fs.outputJson(path.join(repository, '.bowman', 'meta.json'), { name: 'Operator', dataModelVersion: 6, rootPhaseIds: [] });
  await addCheckout(repository, (await accounts.findAccount('ana'))!.id, 'operator');

  await ana.spaces.remove({ space: created });
  await ana.spaces.remove({ space: 'operator' });
  assert.ok(await fs.pathExists(createdDirectory), 'restorable while deleted');
  await purgeDeletedSpaces(later());

  assert.equal(await fs.pathExists(createdDirectory), false);
  assert.ok(await fs.pathExists(path.join(repository, '.bowman', 'meta.json')), 'the operator\'s repository stays');
  assert.deepEqual([...listSpaces(), ...listDeletedSpaces()], []);
  // The repository may be listed again.
  await addCheckout(repository, null, 'operator');
});

test('a space gone for good leaves no offer in other spaces and no token naming it', async () => {
  const ana = await loggedIn('ana');
  const ben = await loggedIn('ben');
  const hub = (await ana.spaces.create({ name: 'Hub' })).slug;
  const ideaId = (await ana.idea.createFloatingIdea({ space: hub, idea: { text: 'A shared kitchen' } })).id;
  const kitchen = (await ben.spaces.create({ name: 'Ben cooks' })).slug;
  const { repoId } = await ben.project.getMeta({ space: kitchen });
  await ben.notes.add({ space: hub, ideaId, kind: 'offer', text: 'Take it', offeredSpace: { host: `https://hub.example.org/spaces/${kitchen}/`, repoId: repoId!, name: 'Ben cooks' } });
  const { token } = await ben.auth.issueToken({ label: 'agent', spaces: [kitchen, hub] });
  await ben.auth.issueToken({ label: 'only the kitchen', spaces: [kitchen] });

  await ben.spaces.remove({ space: kitchen });
  assert.equal((await ana.notes.list({ space: hub, ideaId })).notes.filter(note => note.kind === 'offer').length, 1, 'kept while restorable');
  await purgeDeletedSpaces(later());

  assert.deepEqual((await ana.notes.list({ space: hub, ideaId })).notes.filter(note => note.kind === 'offer'), []);
  const tokens = (await ben.auth.listTokens()).filter(entry => entry.spaces);
  assert.deepEqual(tokens.map(entry => entry.spaces), [[hub]], 'the token limited to the kitchen alone is revoked');
  // A new space under the old slug is not the old token's.
  const reused = (await ben.spaces.create({ name: 'Ben cooks' })).slug;
  assert.equal(reused, kitchen);
  await assert.rejects(appRouter.createCaller({ session: { token } }).idea.createFloatingIdea({ space: reused, idea: { text: 'x' } }), /open read-only|Log in/);
});

test('a directory outside the server\'s own is never removed, whatever spaces.json says', async () => {
  const outside = path.join(root, 'precious');
  await fs.outputFile(path.join(outside, 'keep.txt'), 'keep');
  const file = path.join(root, 'server', 'spaces.json');
  await fs.outputJson(file, { spaces: [{ slug: 'odd', kind: 'created', path: outside, owner: null, writers: [], createdAt: '', deletedAt: new Date(0).toISOString() }] });
  forgetServerFile('spaces.json');

  await assert.rejects(purgeDeletedSpaces(), /points outside/);
  assert.ok(await fs.pathExists(path.join(outside, 'keep.txt')));
});
