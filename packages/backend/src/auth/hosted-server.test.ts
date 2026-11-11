// The hosted server on a private port: one origin for the runtime config, the
// API and the MCP proxy; the login token travels as a bearer over HTTP and in
// the WebSocket's connection params.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server';
import { createContext } from '../trpc';
import { clearIndices } from '../search';
import * as accounts from './accounts';

let root = '';
let base = '';
let stop: (() => Promise<void>) | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-hosted-'));
  await fs.ensureDir(path.join(root, '.bowman'));
  await accounts.createUser(root, 'writer', 'write', 'writer password');
  Object.assign(process.env, { AIMPARENCY_HOSTED: 'true', AIMPARENCY_PROJECT: root, PORT: '0', PORT_MCP: '1' });
  const { server, wss } = startServer();
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stop = async () => {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  };
});

afterEach(async () => {
  await stop?.();
  for (const key of ['AIMPARENCY_HOSTED', 'AIMPARENCY_PROJECT', 'PORT', 'PORT_MCP']) delete process.env[key];
  clearIndices(path.join(root, '.bowman'));
  await fs.remove(root);
});

const call = async (procedure: string, input: unknown, token?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}/trpc/${procedure}`, { method: 'POST', headers, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() as any };
};

test('one port serves the runtime config, the API and the MCP proxy', async () => {
  const config = await (await fetch(`${base}/runtime-config.json`)).json();
  assert.deepEqual(config, { sameOrigin: true, hosted: true, readOnly: false, agents: false, project: path.join(root, '.bowman'), voiceEnabled: false });

  const me = await (await fetch(`${base}/trpc/auth.me`)).json() as any;
  assert.equal(me.result.data.hosted, true);
  assert.equal(me.result.data.role, 'read');

  // No MCP server listens on its port here: the proxy says so instead of hanging.
  const mcp = await fetch(`${base}/mcp/sse`);
  assert.equal(mcp.status, 502);
});

test('a bearer token writes, no token only reads', async () => {
  const projectPath = root;
  const anonymous = await call('idea.createFloatingIdea', { projectPath, idea: { text: 'Anonymous' } });
  assert.equal(anonymous.status, 403);
  assert.match(anonymous.body.error.message, /log in to edit/);

  const { body: login } = await call('auth.login', { name: 'writer', password: 'writer password' });
  const created = await call('idea.createFloatingIdea', { projectPath, idea: { text: 'Shared' } }, login.result.data.token);
  assert.equal(created.status, 200);
});

test('the WebSocket carries the token in its connection params', () => {
  assert.equal(createContext({ info: { connectionParams: { clientId: 'tab', token: 'secret' } } }).token, 'secret');
});

test('errors carry no server stack trace', async () => {
  const refused = await call('idea.createFloatingIdea', { projectPath: root, idea: { text: 'Anonymous' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.data.stack, undefined);
  const input = encodeURIComponent(JSON.stringify({ projectPath: root, phaseId: '../meta' }));
  const invalid = await fetch(`${base}/trpc/phase.get?input=${input}`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as any).error.data.stack, undefined);
});

test('read-only: nobody writes, not even an admin, and the UI is told', async () => {
  process.env.AIMPARENCY_READ_ONLY = 'true';
  try {
    await accounts.createUser(root, 'boss', 'admin', 'boss password');
    const config = await (await fetch(`${base}/runtime-config.json`)).json() as any;
    assert.equal(config.readOnly, true);
    const { body: login } = await call('auth.login', { name: 'boss', password: 'boss password' });
    const token = login.result.data.token;
    for (const [procedure, input] of [
      ['idea.createFloatingIdea', { projectPath: root, idea: { text: 'Edit' } }],
      ['history.restore', { projectPath: root, changes: [] }],
      ['auth.createUser', { name: 'friend', role: 'write', password: 'friend password' }]
    ] as const) {
      const refused = await call(procedure, input, token);
      assert.equal(refused.status, 403, procedure);
      assert.match(refused.body.error.message, /open read-only here: it changes through its Git repository/);
    }
    const input = encodeURIComponent(JSON.stringify({ projectPath: root }));
    const access = await (await fetch(`${base}/trpc/project.getAccess?input=${input}`)).json() as any;
    assert.equal(access.result.data.writable, false);
    const ideas = await (await fetch(`${base}/trpc/idea.list?input=${input}`)).json() as any;
    assert.ok(Array.isArray(ideas.result.data));
  } finally {
    delete process.env.AIMPARENCY_READ_ONLY;
  }
});
