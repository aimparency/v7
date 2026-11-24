// Discarding an account held only by a browser key, by its person or when idle.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from './accounts';
import { listSpaces } from '../spaces/registry';
import { discardIdleAccounts } from './discard';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
type Caller = ReturnType<typeof appRouter.createCaller>;
const callerOf = (token: string) => appRouter.createCaller({ session: { token } });

let ana: Caller;
let hub = '';
let ideaId = '';

const guest = async (key: string) => {
  const account = await accounts.createKeyAccount(key);
  return { account, caller: callerOf(await accounts.issueToken(account.name, 'browser')) };
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-discard-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', spaceCreation: 'everyone' } as never);
  await accounts.createAccount('ana', 'ana password');
  ana = callerOf((await accounts.login('ana', 'ana password'))!);
  hub = (await ana.spaces.create({ name: 'Hack the Hub' })).slug;
  ideaId = (await ana.idea.createFloatingIdea({ space: hub, idea: { text: 'A shared kitchen' } })).id;
});

afterEach(async () => {
  for (const space of listSpaces()) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('discarding a browser-key account removes its spaces, notes, offers, rights and logins', async () => {
  const { account, caller } = await guest('key-ben');
  const kitchen = (await caller.spaces.create({ name: 'Ben cooks' })).slug;
  const repoId = (await caller.project.getMeta({ space: kitchen })).repoId!;
  await caller.notes.add({ space: hub, ideaId, kind: 'note', text: 'Breakfast too?' });
  await caller.notes.add({ space: hub, ideaId, kind: 'offer', text: '', offeredSpace: { host: `https://hub.example.org/spaces/${kitchen}`, repoId, name: 'Ben cooks' } });
  await ana.spaces.setAccess({ space: hub, writers: [account.name] });
  await ana.notes.add({ space: hub, ideaId, kind: 'note', text: 'Ana stays' });

  assert.deepEqual(await caller.auth.ownFootprint(), { spaces: ['Ben cooks'], passedOn: [], notes: 1, offers: 1 });
  assert.equal(await ana.auth.ownFootprint(), null, 'a permanent account is logged out, not discarded');
  await assert.rejects(ana.auth.discardOwnAccount(), /permanent login/);

  await caller.auth.discardOwnAccount();
  assert.deepEqual(listSpaces().map(space => space.slug), [hub]);
  assert.equal(await fs.pathExists(path.join(root, 'spaces', kitchen)), false);
  assert.deepEqual((await ana.notes.list({ space: hub, ideaId })).notes.map(note => note.text), ['Ana stays']);
  assert.deepEqual(listSpaces()[0]!.writers, []);
  assert.equal(accounts.findAccount(account.name), null);
  assert.equal(accounts.resolveToken('anything'), null);
  assert.equal((await caller.auth.me()).name, null, 'its login is gone');
});

test('a space others manage or write in passes to a manager, else the writer added first; only one nobody else is in goes', async () => {
  const { account: ben, caller } = await guest('key-ben');
  const { account: cleo } = await guest('key-cleo');
  const { account: dana } = await guest('key-dana');
  const garden = (await caller.spaces.create({ name: 'Garden' })).slug;
  const bakery = (await caller.spaces.create({ name: 'Bakery' })).slug;
  const alone = (await caller.spaces.create({ name: 'Alone' })).slug;
  await caller.spaces.setAccess({ space: garden, writers: [cleo.name, dana.name] });
  await caller.spaces.setAccess({ space: bakery, writers: [cleo.name], managers: [dana.name] });
  const gardenRepo = (await caller.project.getMeta({ space: garden })).repoId!;
  await caller.notes.add({ space: hub, ideaId, kind: 'offer', text: '', offeredSpace: { host: `https://hub.example.org/spaces/${garden}`, repoId: gardenRepo, name: 'Garden' } });

  assert.deepEqual(await caller.auth.ownFootprint(), { spaces: ['Alone'], passedOn: ['Garden', 'Bakery'], notes: 0, offers: 1 });
  await caller.auth.discardOwnAccount();

  const bySlug = new Map(listSpaces().map(space => [space.slug, space]));
  assert.equal(bySlug.has(alone), false, 'nobody else was in it');
  assert.equal(await fs.pathExists(path.join(root, 'spaces', alone)), false);
  assert.equal(bySlug.get(garden)!.owner, cleo.id, 'the writer added first');
  assert.deepEqual(bySlug.get(garden)!.writers, [dana.id]);
  assert.equal(bySlug.get(bakery)!.owner, dana.id, 'a manager before writers');
  assert.deepEqual(bySlug.get(bakery)!.managers, []);
  assert.deepEqual(bySlug.get(bakery)!.writers, [cleo.id]);
  assert.equal(accounts.findAccount(ben.name), null);
  assert.equal((await ana.notes.list({ space: hub, ideaId })).notes.length, 0, 'its own offer goes with it, as any note it wrote');
});

test('automatic accounts unused for longer than the server allows are discarded; others stay', async () => {
  const { caller: old } = await guest('key-old');
  await old.spaces.create({ name: 'Old space' });
  const { caller: recent } = await guest('key-recent');
  await recent.auth.me(); // today
  const DAY = 24 * 60 * 60 * 1000;

  assert.equal(await discardIdleAccounts(Date.now() + 100 * DAY), 0, 'nothing is idle long enough yet');
  updateServerConfig({ limits: { idleAutomaticAccountDays: 30 } } as never);
  assert.equal(await discardIdleAccounts(Date.now() + 31 * DAY), 2);
  assert.deepEqual(accounts.listAccounts().map(account => account.name), ['ana'], 'the permanent account stays');
  assert.deepEqual(listSpaces().map(space => space.slug), [hub]);
});
