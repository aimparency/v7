// A server for other people on a private port: one origin for the runtime
// config, the API and the MCP proxy; the login token travels as a bearer over
// HTTP and in the WebSocket's connection params.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { updateServerConfig } from 'shared/server-config';
import { startServer } from '../server';
import { createContext } from '../trpc';
import * as accounts from './accounts';

let root = '';
let base = '';
let stop: (() => Promise<void>) | undefined;
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;

async function start(login: 'none' | 'accounts') {
  updateServerConfig({ login });
  Object.assign(process.env, { AIMPARENCY_ONE_PORT: 'true', PORT: '0', PORT_MCP: '1', AIMPARENCY_PULL_SECONDS: '0' });
  const { server, wss } = startServer();
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stop = async () => {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-server-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
});

afterEach(async () => {
  await stop?.();
  stop = undefined;
  for (const key of ['AIMPARENCY_ONE_PORT', 'PORT', 'PORT_MCP', 'AIMPARENCY_PULL_SECONDS']) delete process.env[key];
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

const call = async (procedure: string, input: unknown, token?: string, origin?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const response = await fetch(`${base}/trpc/${procedure}`, { method: 'POST', headers, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json().catch(() => null) as any };
};

test('one port serves the runtime config, the API and the MCP proxy', async () => {
  await start('accounts');
  const config = await (await fetch(`${base}/runtime-config.json`)).json();
  assert.deepEqual(config, { sameOrigin: true, login: 'accounts', agents: false, voiceEnabled: false });

  const me = await (await fetch(`${base}/trpc/auth.me`)).json() as any;
  assert.deepEqual(me.result.data, {
    login: 'accounts', agents: false, signUp: { open: false, browserKey: false }, name: null, serverAdmin: false, canCreateGraphs: false, permanentLogin: true
  });

  // No MCP server listens on its port here: the proxy says so instead of hanging.
  const mcp = await fetch(`${base}/mcp/sse`);
  assert.equal(mcp.status, 502);
});

test('sign in, create a graph, write it with the bearer token; no token only reads', async () => {
  await start('accounts');
  await accounts.createAccount('ada', 'ada password');
  const { body: login } = await call('auth.login', { name: 'ada', password: 'ada password' });
  const token = login.result.data.token;
  const { body: graph } = await call('graphs.create', { name: 'Hack the Hub' }, token);
  const projectPath = graph.result.data.slug;
  assert.equal(projectPath, 'hack-the-hub');

  const anonymous = await call('idea.createFloatingIdea', { projectPath, idea: { text: 'Anonymous' } });
  assert.equal(anonymous.status, 403);
  assert.match(anonymous.body.error.message, /log in to edit/);
  assert.equal((await call('idea.createFloatingIdea', { projectPath, idea: { text: 'Shared' } }, token)).status, 200);

  const input = encodeURIComponent(JSON.stringify({ projectPath }));
  const ideas = await (await fetch(`${base}/trpc/idea.list?input=${input}`)).json() as any;
  assert.deepEqual(ideas.result.data.map((idea: { text: string }) => idea.text), ['Shared']);
  // Nothing a visitor gets names a directory of the server.
  assert.ok(!JSON.stringify(ideas).includes(root));
});

test('the WebSocket carries the token in its connection params', () => {
  assert.equal(createContext({ info: { connectionParams: { clientId: 'tab', token: 'secret' } } }).session?.token, 'secret');
});

test('errors carry no server stack trace', async () => {
  await start('accounts');
  const refused = await call('graphs.create', { name: 'Anonymous' });
  assert.equal(refused.status, 401);
  assert.equal(refused.body.error.data.stack, undefined);
  const input = encodeURIComponent(JSON.stringify({ projectPath: '/etc' }));
  const path = await fetch(`${base}/trpc/idea.list?input=${input}`);
  assert.equal(path.status, 403);
  assert.equal((await path.json() as any).error.data.stack, undefined);
});

test('without login only pages of this machine reach the API', async () => {
  await start('none');
  const repository = path.join(root, 'repo');
  await fs.ensureDir(repository);
  const idea = { projectPath: repository, idea: { text: 'Mine' } };
  assert.equal((await call('idea.createFloatingIdea', idea, undefined, 'http://localhost:4000')).status, 200);
  assert.equal((await call('idea.createFloatingIdea', idea)).status, 200, 'a local program sends no Origin');
  assert.equal((await call('idea.createFloatingIdea', idea, undefined, 'https://evil.example')).status, 403);
});
