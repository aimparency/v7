import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import * as accounts from './accounts';

let root = '';
let projectPath = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-auth-'));
  projectPath = path.join(root, '.bowman');
  await fs.ensureDir(projectPath);
});

afterEach(async () => {
  delete process.env.AIMPARENCY_HOSTED;
  delete process.env.AIMPARENCY_PROJECT;
  clearIndices(projectPath);
  await fs.remove(root);
});

const host = () => {
  process.env.AIMPARENCY_HOSTED = 'true';
  process.env.AIMPARENCY_PROJECT = root;
};

const as = (token?: string) => appRouter.createCaller({ token });

test('passwords and tokens round-trip, and a revoked token is gone', async () => {
  await accounts.createUser(projectPath, 'ada', 'write', 'correct horse');
  assert.equal(await accounts.login(projectPath, 'ada', 'wrong password'), null);
  const token = await accounts.login(projectPath, 'ada', 'correct horse');
  assert.ok(token);
  assert.deepEqual(await accounts.resolveToken(projectPath, token), { name: 'ada', role: 'write' });
  await accounts.revokeToken(projectPath, token);
  assert.equal(await accounts.resolveToken(projectPath, token), null);
  const stored = await fs.readFile(accounts.accountsFile(projectPath), 'utf8');
  assert.ok(!stored.includes('correct horse'));
});

test('the last admin can be neither removed nor demoted', async () => {
  await accounts.createUser(projectPath, 'admin', 'admin', 'admin password');
  await assert.rejects(accounts.setRole(projectPath, 'admin', 'write'), /last admin/);
  await assert.rejects(accounts.removeUser(projectPath, 'admin'), /last admin/);
  await accounts.createUser(projectPath, 'second', 'admin', 'second password');
  await accounts.removeUser(projectPath, 'admin');
  assert.deepEqual(await accounts.listUsers(projectPath), [{ name: 'second', role: 'admin' }]);
});

test('a hosted instance lets anyone read, account holders write and admins manage accounts', async () => {
  const phase = await as().phase.create({ projectPath, phase: { name: 'Now' } }) as { id: string };
  const idea = await as().idea.createIdeaInPhase({ projectPath, phaseId: phase.id, idea: { text: 'Shared' } });
  await accounts.createUser(projectPath, 'admin', 'admin', 'admin password');
  await accounts.createUser(projectPath, 'writer', 'write', 'writer password');
  host();

  const guest = as();
  assert.equal((await guest.idea.list({ projectPath })).length, 1);
  assert.deepEqual(await guest.project.getAccess({ projectPath }), {
    writable: false, reason: 'This project is open read-only here: log in to edit.', user: null, role: 'read'
  });
  await assert.rejects(guest.idea.update({ projectPath, ideaId: idea.id, idea: { text: 'Guest edit' } }), /open read-only/);

  const { token: writerToken } = await guest.auth.login({ name: 'writer', password: 'writer password' });
  const writer = as(writerToken);
  await writer.idea.update({ projectPath, ideaId: idea.id, idea: { text: 'Writer edit' } });
  assert.equal((await guest.idea.get({ projectPath, ideaId: idea.id })).text, 'Writer edit');
  await assert.rejects(writer.auth.createUser({ name: 'friend', role: 'write', password: 'friend password' }), /admins only/);
  await assert.rejects(writer.project.updateMeta({ projectPath, meta: { name: 'Renamed', color: '#123456' } }), /admins only/);

  const { token: adminToken } = await guest.auth.login({ name: 'admin', password: 'admin password' });
  await as(adminToken).auth.createUser({ name: 'friend', role: 'write', password: 'friend password' });
  assert.deepEqual((await as(adminToken).auth.listUsers()).map(user => user.name), ['admin', 'writer', 'friend']);
});

test('a hosted instance serves one project and none of the local-only tools', async () => {
  await accounts.createUser(projectPath, 'admin', 'admin', 'admin password');
  host();
  const token = await accounts.login(projectPath, 'admin', 'admin password');
  const admin = as(token!);
  await assert.rejects(admin.idea.list({ projectPath: path.join(os.tmpdir(), 'elsewhere') }), /one project only/);
  await assert.rejects(admin.project.inspectPath({ projectPath: '/' }), /not available on a hosted instance/);
  await assert.rejects(admin.project.discoverLocalProjects(), /not available on a hosted instance/);
  await assert.rejects(admin.loop.getConfig({ projectPath }), /not available on a hosted instance/);
});

test('a wrong password is refused', async () => {
  await accounts.createUser(projectPath, 'admin', 'admin', 'admin password');
  host();
  await assert.rejects(as().auth.login({ name: 'admin', password: 'nope' }), /Wrong name or password/);
});
