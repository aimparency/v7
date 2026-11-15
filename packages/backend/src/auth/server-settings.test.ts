// What a server admin changes in the UI: the server's settings, and repositories
// on the machine added as graphs. Nobody else may.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { serverConfig, updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-server-settings-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts', port: 4100 });
  await accounts.createAccount('admin', 'admin password', { serverAdmin: true });
  await accounts.createAccount('ana', 'ana password');
});

afterEach(async () => {
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const loggedIn = async (name: string) => {
  const caller = appRouter.createCaller({ session: {}, address: '10.0.0.1' });
  await caller.auth.login({ name, password: `${name} password` });
  return caller;
};

test('a server admin sets the public address and sign-up; the rest of server.json stays', async () => {
  const admin = await loggedIn('admin');
  await admin.auth.setServerSettings({ publicUrl: 'https://graphs.example.org/', signUp: { open: true }, graphCreation: 'selected' });
  assert.equal(serverConfig().publicUrl, 'https://graphs.example.org');
  assert.equal(serverConfig().signUp.open, true);
  assert.equal(serverConfig().signUp.browserKey, false);
  assert.equal(serverConfig().graphCreation, 'selected');
  assert.equal(serverConfig().port, 4100);
  assert.deepEqual(await admin.auth.getServerSettings(), {
    publicUrl: 'https://graphs.example.org', graphCreation: 'selected',
    signUp: { open: true, browserKey: false, wallet: false }, notes: 'everyone'
  });

  // Empty: no public address any more.
  await admin.auth.setServerSettings({ publicUrl: '' });
  assert.equal(serverConfig().publicUrl, undefined);
  await assert.rejects(admin.auth.setServerSettings({ publicUrl: 'ftp://elsewhere' }), /https:\/\//);
});

test('only a server admin sees or changes the settings and adds a repository by its path', async () => {
  const ana = await loggedIn('ana');
  await assert.rejects(ana.auth.getServerSettings(), /server admin/i);
  await assert.rejects(ana.auth.setServerSettings({ publicUrl: 'https://mine.example.org' }), /server admin/i);
  const repository = path.join(root, 'repository');
  await fs.ensureDir(path.join(repository, '.bowman'));
  await assert.rejects(ana.graphs.addCheckout({ path: repository }), /server admin/i);

  const admin = await loggedIn('admin');
  assert.equal((await admin.graphs.addCheckout({ path: repository })).slug, 'repository');
  await assert.rejects(admin.graphs.addCheckout({ path: repository }), /already/);
  await assert.rejects(admin.graphs.addCheckout({ path: path.join(root, 'nowhere') }), /No such directory/);
});
