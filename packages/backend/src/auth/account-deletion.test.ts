// A person deletes their account: logged out everywhere at once; logging in
// within ACCOUNT_DELETION_DAYS brings it back, after that it is discarded.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import { listSpaces } from '../spaces/registry';
import { discardIdleAccounts } from './discard';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const DAY = 24 * 60 * 60 * 1000;
const visitor = () => appRouter.createCaller({ session: {} });
const loggedIn = async (name: string, rights: { serverAdmin?: boolean; canCreateSpaces?: boolean } = {}) => {
  if (!accounts.findAccount(name)) await accounts.createAccount(name, `${name} password`, rights);
  const session: { token?: string } = { token: (await accounts.login(name, `${name} password`))! };
  return { caller: appRouter.createCaller({ session }), session };
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-account-deletion-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', spaceCreation: 'everyone' });
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
});

afterEach(async () => {
  for (const space of listSpaces()) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('deleting logs out everywhere; logging in again within the days brings the account back', async () => {
  const { caller: david, session } = await loggedIn('david');
  const agentToken = await accounts.issueToken('david', 'claude');
  const slug = (await david.spaces.create({ name: 'Game' })).slug;

  const { days } = await david.auth.deleteOwnAccount();
  assert.equal(days, accounts.ACCOUNT_DELETION_DAYS);
  assert.equal(session.token, undefined);
  assert.equal(accounts.resolveToken(agentToken), null);
  assert.ok(accounts.listAccounts().find(account => account.name === 'david')?.deletedAt);
  // Its name stays taken meanwhile.
  await assert.rejects(accounts.createAccount('david', 'other password'), /exists|taken/i);

  const { token, restored } = await visitor().auth.login({ name: 'david', password: 'david password' });
  assert.equal(restored, true);
  assert.equal(accounts.listAccounts().find(account => account.name === 'david')?.deletedAt, undefined);
  assert.ok(await appRouter.createCaller({ session: { token } }).project.getMeta({ space: slug }));
  assert.equal((await visitor().auth.login({ name: 'david', password: 'david password' })).restored, false);
});

test('after the days the account goes, with the spaces it owns', async () => {
  const { caller: david } = await loggedIn('david');
  await david.spaces.create({ name: 'Game' });
  await david.auth.deleteOwnAccount();

  assert.equal(await discardIdleAccounts(Date.now() + (accounts.ACCOUNT_DELETION_DAYS - 1) * DAY), 0);
  assert.ok(accounts.findAccount('david'));
  assert.equal(await discardIdleAccounts(Date.now() + (accounts.ACCOUNT_DELETION_DAYS + 1) * DAY), 1);
  assert.equal(accounts.findAccount('david'), null);
  assert.deepEqual(listSpaces().map(space => space.slug), []);
});

test('a server admin does not delete their own account; a visitor has none to delete', async () => {
  const { caller: admin } = await loggedIn('admin');
  await assert.rejects(admin.auth.deleteOwnAccount(), /server admin cannot delete/);
  await assert.rejects(visitor().auth.deleteOwnAccount(), /Log in first/);
});
