// A server admin restarts the server from the UI, only under a supervisor
// that starts it again; nobody else may.
import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { RESTART_EXIT_CODE } from '../server-restart';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const loggedIn = async (name: string, serverAdmin: boolean) => {
  await accounts.createAccount(name, `${name} password`, { serverAdmin });
  return appRouter.createCaller({ session: { token: (await accounts.login(name, `${name} password`))! } });
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-server-restart-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts' });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.AIMPARENCY_SUPERVISED;
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('without a supervisor nothing restarts, and the UI offers nothing', async () => {
  const admin = await loggedIn('admin', true);
  assert.equal((await admin.auth.me()).restartable, false);
  await assert.rejects(admin.auth.restartServer(), /supervisor/);
});

test('under a supervisor a server admin restarts it: the backend exits with the restart code', async () => {
  process.env.AIMPARENCY_SUPERVISED = 'true';
  const admin = await loggedIn('admin', true);
  const ana = await loggedIn('ana', false);
  assert.equal((await admin.auth.me()).restartable, true);
  assert.equal((await ana.auth.me()).restartable, false);
  await assert.rejects(ana.auth.restartServer(), /server admin/i);
  await assert.rejects(appRouter.createCaller({ session: {} }).auth.updateServer(), /server admin|log in/i);

  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  assert.deepEqual(await admin.auth.restartServer(), { restarting: true });
  assert.equal(exit.mock.calls.length, 0);
  vi.advanceTimersByTime(600);
  assert.deepEqual(exit.mock.calls, [[RESTART_EXIT_CODE]]);
});
