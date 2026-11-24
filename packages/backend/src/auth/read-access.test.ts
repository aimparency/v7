// Who reads a space: everyone, every account, or the accounts its owner named
// (server.json guestDefaults.read, or the space's own setting). Its owner, its
// writers and the server admins always do.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { serverConfig, updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import { listSpaces } from '../spaces/registry';
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
  slug = (await ana.spaces.create({ name: 'Plans' })).slug;
  ideaId = (await ana.idea.createFloatingIdea({ space: slug, idea: { text: 'A shared kitchen' } })).id;
});

afterEach(async () => {
  for (const space of listSpaces()) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const listed = async (caller: Caller) => (await caller.spaces.list()).map(space => space.slug);

test('the server default "accounts": a visitor reads nothing and is asked to log in; every account reads', async () => {
  await assert.rejects(anonymous().project.getMeta({ space: slug }), /log in to see it/);
  await assert.rejects(anonymous().spaces.getAccess({ space: slug }), /log in to see it/);
  await assert.rejects(anonymous().notes.list({ space: slug, ideaId }), /log in to see it/);
  assert.deepEqual(await listed(anonymous()), []);
  assert.equal((await anonymous().auth.me()).read, 'accounts');

  assert.ok(await ben.project.getMeta({ space: slug }));
  assert.deepEqual(await listed(ben), [slug]);
  // Reading is not writing.
  await assert.rejects(ben.idea.update({ space: slug, ideaId, idea: { text: 'Mine now' } }), /open read-only/);
});

test('a space open to selected accounts: its owner, writers, readers and the server admins read it, nobody else', async () => {
  await ana.spaces.setAccess({ space: slug, read: 'selected', readers: ['ben'] });
  assert.deepEqual(await ana.spaces.getAccess({ space: slug }).then(access => [access?.read, access?.readers]), ['selected', ['ben']]);

  assert.ok(await ben.project.getMeta({ space: slug }));
  assert.ok(await admin.project.getMeta({ space: slug }));
  await assert.rejects(cleo.project.getMeta({ space: slug }), /ask its owner/);
  await assert.rejects(anonymous().project.getMeta({ space: slug }), /log in/);
  assert.deepEqual(await listed(cleo), []);
  assert.deepEqual(await listed(ben), [slug]);

  // Nothing of it, not even a note, for whom may not read it, whatever the notes setting.
  await assert.rejects(cleo.notes.add({ space: slug, ideaId, kind: 'note', text: 'Hi' }), /ask its owner/);
  await ben.notes.add({ space: slug, ideaId, kind: 'note', text: 'Hi' });

  // A writer reads without being named a reader.
  await ana.spaces.setAccess({ space: slug, writers: ['cleo'] });
  assert.ok(await cleo.project.getMeta({ space: slug }));

  // Only the owner decides who reads.
  await assert.rejects(ben.spaces.setAccess({ space: slug, read: 'everyone' }), /owner/);
});

test('an owner opens one space to everyone on a server whose spaces are for accounts', async () => {
  await ana.spaces.setAccess({ space: slug, read: 'everyone' });
  assert.ok(await anonymous().project.getMeta({ space: slug }));
  assert.deepEqual(await listed(anonymous()), [slug]);
  // null: back to the server's default.
  await ana.spaces.setAccess({ space: slug, read: null });
  assert.equal((await ana.spaces.getAccess({ space: slug }))?.read, 'accounts');
  await assert.rejects(anonymous().project.getMeta({ space: slug }), /log in/);
});

test('without a setting everyone reads, as before', async () => {
  updateServerConfig({ guestDefaults: { notes: 'everyone', read: 'everyone' } });
  assert.ok(await anonymous().project.getMeta({ space: slug }));
  assert.deepEqual(await listed(anonymous()), [slug]);
});

test('a token limited to other spaces reads none of a space for accounts', async () => {
  const other = (await ben.spaces.create({ name: 'Elsewhere' })).slug;
  const token = await accounts.issueToken('ben', 'mcp', [other]);
  const scoped = appRouter.createCaller({ session: { token } });
  assert.ok(await scoped.project.getMeta({ space: other }));
  await assert.rejects(scoped.project.getMeta({ space: slug }), /log in/);
});

test('a server admin sets the default; a discarded account leaves the readers', async () => {
  await admin.auth.setServerSettings({ read: 'selected' });
  assert.equal(serverConfig().guestDefaults.read, 'selected');
  assert.equal(serverConfig().guestDefaults.notes, 'everyone');
  assert.equal((await admin.auth.getServerSettings()).read, 'selected');
  await assert.rejects(ben.auth.setServerSettings({ read: 'everyone' }), /server admin/i);
  await assert.rejects(ben.project.getMeta({ space: slug }), /ask its owner/);

  await ana.spaces.setAccess({ space: slug, readers: ['ben'] });
  const benId = accounts.findAccount('ben')!.id;
  await discardAccount(benId);
  assert.deepEqual(listSpaces().find(space => space.slug === slug)?.readers, []);
});
