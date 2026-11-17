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
import { addCheckout, DELETED_DAYS, listDeletedGraphs, listGraphs } from './registry';
import { purgeDeletedGraphs } from './deletion';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const later = () => Date.now() + DELETED_DAYS * 86_400_000;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-deletion-'));
  process.env.AIMPARENCY_SERVER_DIR = path.join(root, 'server');
  updateServerConfig({ login: 'accounts' });
});

afterEach(async () => {
  for (const graph of [...listGraphs(), ...listDeletedGraphs()]) clearIndices(graph.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const loggedIn = async (name: string) => {
  await accounts.createAccount(name, `${name} password`);
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

test('a space created here goes with its repository; of a checkout only the server\'s entry goes', async () => {
  const ana = await loggedIn('ana');
  const created = (await ana.graphs.create({ name: 'Made here' })).slug;
  const createdDirectory = listGraphs().find(graph => graph.slug === created)!.path;
  const repository = path.join(root, 'operator-repo');
  await fs.outputJson(path.join(repository, '.bowman', 'meta.json'), { name: 'Operator', dataModelVersion: 6, rootPhaseIds: [] });
  await addCheckout(repository, (await accounts.findAccount('ana'))!.id, 'operator');

  await ana.graphs.remove({ graph: created });
  await ana.graphs.remove({ graph: 'operator' });
  assert.ok(await fs.pathExists(createdDirectory), 'restorable while deleted');
  await purgeDeletedGraphs(later());

  assert.equal(await fs.pathExists(createdDirectory), false);
  assert.ok(await fs.pathExists(path.join(repository, '.bowman', 'meta.json')), 'the operator\'s repository stays');
  assert.deepEqual([...listGraphs(), ...listDeletedGraphs()], []);
  // The repository may be listed again.
  await addCheckout(repository, null, 'operator');
});

test('a space gone for good leaves no offer in other spaces and no token naming it', async () => {
  const ana = await loggedIn('ana');
  const ben = await loggedIn('ben');
  const hub = (await ana.graphs.create({ name: 'Hub' })).slug;
  const ideaId = (await ana.idea.createFloatingIdea({ graph: hub, idea: { text: 'A shared kitchen' } })).id;
  const kitchen = (await ben.graphs.create({ name: 'Ben cooks' })).slug;
  const { repoId } = await ben.project.getMeta({ graph: kitchen });
  await ben.notes.add({ graph: hub, ideaId, kind: 'offer', text: 'Take it', space: { host: `https://hub.example.org/spaces/${kitchen}/`, repoId: repoId!, name: 'Ben cooks' } });
  const { token } = await ben.auth.issueToken({ label: 'agent', graphs: [kitchen, hub] });
  await ben.auth.issueToken({ label: 'only the kitchen', graphs: [kitchen] });

  await ben.graphs.remove({ graph: kitchen });
  assert.equal((await ana.notes.list({ graph: hub, ideaId })).notes.filter(note => note.kind === 'offer').length, 1, 'kept while restorable');
  await purgeDeletedGraphs(later());

  assert.deepEqual((await ana.notes.list({ graph: hub, ideaId })).notes.filter(note => note.kind === 'offer'), []);
  const tokens = (await ben.auth.listTokens()).filter(entry => entry.graphs);
  assert.deepEqual(tokens.map(entry => entry.graphs), [[hub]], 'the token limited to the kitchen alone is revoked');
  // A new space under the old slug is not the old token's.
  const reused = (await ben.graphs.create({ name: 'Ben cooks' })).slug;
  assert.equal(reused, kitchen);
  await assert.rejects(appRouter.createCaller({ session: { token } }).idea.createFloatingIdea({ graph: reused, idea: { text: 'x' } }), /open read-only|Log in/);
});

test('a directory outside the server\'s own is never removed, whatever graphs.json says', async () => {
  const outside = path.join(root, 'precious');
  await fs.outputFile(path.join(outside, 'keep.txt'), 'keep');
  const file = path.join(root, 'server', 'graphs.json');
  await fs.outputJson(file, { graphs: [{ slug: 'odd', kind: 'created', path: outside, owner: null, writers: [], createdAt: '', deletedAt: new Date(0).toISOString() }] });
  forgetServerFile('graphs.json');

  await assert.rejects(purgeDeletedGraphs(), /points outside/);
  assert.ok(await fs.pathExists(path.join(outside, 'keep.txt')));
});
