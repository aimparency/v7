// Who reads a graph: everyone, every account, or the accounts its owner named
// (server.json guestDefaults.read, or the graph's own setting). Its owner, its
// writers and the server admins always do.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { serverConfig, updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import { listGraphs } from '../graphs/registry';
import { discardAccount } from './discard';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
type Caller = ReturnType<typeof appRouter.createCaller>;
let admin: Caller;
let ana: Caller;
let ben: Caller;
let cleo: Caller;
const anonymous = () => appRouter.createCaller({ session: {} });
let slug = '';
let ideaId = '';

const loggedIn = async (name: string) => {
  await accounts.createAccount(name, `${name} password`, { serverAdmin: name === 'admin' });
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-read-access-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', guestDefaults: { read: 'accounts' } });
  [admin, ana, ben, cleo] = await Promise.all(['admin', 'ana', 'ben', 'cleo'].map(loggedIn)) as [Caller, Caller, Caller, Caller];
  slug = (await ana.graphs.create({ name: 'Plans' })).slug;
  ideaId = (await ana.idea.createFloatingIdea({ graph: slug, idea: { text: 'A shared kitchen' } })).id;
});

afterEach(async () => {
  for (const graph of listGraphs()) clearIndices(graph.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const listed = async (caller: Caller) => (await caller.graphs.list()).map(graph => graph.slug);

test('the server default "accounts": a visitor reads nothing and is asked to log in; every account reads', async () => {
  await assert.rejects(anonymous().project.getMeta({ graph: slug }), /log in to see it/);
  await assert.rejects(anonymous().graphs.getAccess({ graph: slug }), /log in to see it/);
  await assert.rejects(anonymous().notes.list({ graph: slug, ideaId }), /log in to see it/);
  assert.deepEqual(await listed(anonymous()), []);
  assert.equal((await anonymous().auth.me()).read, 'accounts');

  assert.ok(await ben.project.getMeta({ graph: slug }));
  assert.deepEqual(await listed(ben), [slug]);
  // Reading is not writing.
  await assert.rejects(ben.idea.update({ graph: slug, ideaId, idea: { text: 'Mine now' } }), /open read-only/);
});

test('a graph open to selected accounts: its owner, writers, readers and the server admins read it, nobody else', async () => {
  await ana.graphs.setAccess({ graph: slug, read: 'selected', readers: ['ben'] });
  assert.deepEqual(await ana.graphs.getAccess({ graph: slug }).then(access => [access?.read, access?.readers]), ['selected', ['ben']]);

  assert.ok(await ben.project.getMeta({ graph: slug }));
  assert.ok(await admin.project.getMeta({ graph: slug }));
  await assert.rejects(cleo.project.getMeta({ graph: slug }), /ask its owner/);
  await assert.rejects(anonymous().project.getMeta({ graph: slug }), /log in/);
  assert.deepEqual(await listed(cleo), []);
  assert.deepEqual(await listed(ben), [slug]);

  // Nothing of it, not even a note, for whom may not read it, whatever the notes setting.
  await assert.rejects(cleo.notes.add({ graph: slug, ideaId, kind: 'note', text: 'Hi' }), /ask its owner/);
  await ben.notes.add({ graph: slug, ideaId, kind: 'note', text: 'Hi' });

  // A writer reads without being named a reader.
  await ana.graphs.setAccess({ graph: slug, writers: ['cleo'] });
  assert.ok(await cleo.project.getMeta({ graph: slug }));

  // Only the owner decides who reads.
  await assert.rejects(ben.graphs.setAccess({ graph: slug, read: 'everyone' }), /owner/);
});

test('an owner opens one graph to everyone on a server whose spaces are for accounts', async () => {
  await ana.graphs.setAccess({ graph: slug, read: 'everyone' });
  assert.ok(await anonymous().project.getMeta({ graph: slug }));
  assert.deepEqual(await listed(anonymous()), [slug]);
  // null: back to the server's default.
  await ana.graphs.setAccess({ graph: slug, read: null });
  assert.equal((await ana.graphs.getAccess({ graph: slug }))?.read, 'accounts');
  await assert.rejects(anonymous().project.getMeta({ graph: slug }), /log in/);
});

test('without a setting everyone reads, as before', async () => {
  updateServerConfig({ guestDefaults: { notes: 'everyone', read: 'everyone' } });
  assert.ok(await anonymous().project.getMeta({ graph: slug }));
  assert.deepEqual(await listed(anonymous()), [slug]);
});

test('a token limited to other graphs reads none of a graph for accounts', async () => {
  const other = (await ben.graphs.create({ name: 'Elsewhere' })).slug;
  const token = await accounts.issueToken('ben', 'mcp', [other]);
  const scoped = appRouter.createCaller({ session: { token } });
  assert.ok(await scoped.project.getMeta({ graph: other }));
  await assert.rejects(scoped.project.getMeta({ graph: slug }), /log in/);
});

test('a server admin sets the default; a discarded account leaves the readers', async () => {
  await admin.auth.setServerSettings({ read: 'selected' });
  assert.equal(serverConfig().guestDefaults.read, 'selected');
  assert.equal(serverConfig().guestDefaults.notes, 'everyone');
  assert.equal((await admin.auth.getServerSettings()).read, 'selected');
  await assert.rejects(ben.auth.setServerSettings({ read: 'everyone' }), /server admin/i);
  await assert.rejects(ben.project.getMeta({ graph: slug }), /ask its owner/);

  await ana.graphs.setAccess({ graph: slug, readers: ['ben'] });
  const benId = accounts.findAccount('ben')!.id;
  await discardAccount(benId);
  assert.deepEqual(listGraphs().find(graph => graph.slug === slug)?.readers, []);
});
