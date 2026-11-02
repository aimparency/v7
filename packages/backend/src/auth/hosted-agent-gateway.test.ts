// The admins' agents on a hosted instance: a fake broker (WebSocket) and a fake
// agent session (HTTP + WebSocket) on loopback, reached only through the
// hosted port with an admin's cookie.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { startServer } from '../server';
import { clearIndices } from '../search';
import { AGENT_COOKIE, agentRoute } from '../hosted-agent-gateway';
import { neededRole } from './access';
import * as accounts from './accounts';

let root = '';
let base = '';
let sessionPort = 0;
let seen: http.IncomingHttpHeaders & { url?: string } = {};
let adminToken = '';
let writerToken = '';
const closers: Array<() => Promise<unknown>> = [];

const listen = (server: http.Server) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

// Echoes every message, prefixed with the path the upstream saw.
function echo(wss: WebSocketServer) {
  wss.on('connection', (ws, req) => ws.on('message', (data) => ws.send(`${req.url} ${req.headers.origin} ${data}`)));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-agents-'));
  await fs.ensureDir(path.join(root, '.bowman'));
  await accounts.createUser(root, 'boss', 'admin', 'admin password');
  await accounts.createUser(root, 'writer', 'write', 'writer password');
  adminToken = (await accounts.login(root, 'boss', 'admin password'))!;
  writerToken = (await accounts.login(root, 'writer', 'writer password'))!;

  const session = http.createServer((req, res) => {
    seen = { ...req.headers, url: req.url };
    res.end('session');
  });
  echo(new WebSocketServer({ server: session }));
  sessionPort = await listen(session);
  const brokerServer = http.createServer();
  echo(new WebSocketServer({ server: brokerServer }));
  const brokerPort = await listen(brokerServer);

  Object.assign(process.env, {
    AIMPARENCY_HOSTED: 'true', AIMPARENCY_AGENTS: 'true', AIMPARENCY_PROJECT: root, PORT: '0', PORT_MCP: '1',
    PORT_BROKER_WS: String(brokerPort), PORT_PROCESS_START: String(sessionPort), AIMPARENCY_PULL_SECONDS: '0',
  });
  const { server, wss } = startServer();
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closers.push(
    async () => { wss.close(); await new Promise((resolve) => server.close(resolve)); },
    () => new Promise((resolve) => session.close(resolve)),
    () => new Promise((resolve) => brokerServer.close(resolve)),
  );
});

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const key of ['AIMPARENCY_HOSTED', 'AIMPARENCY_AGENTS', 'AIMPARENCY_PROJECT', 'PORT', 'PORT_MCP', 'PORT_BROKER_WS', 'PORT_PROCESS_START', 'AIMPARENCY_PULL_SECONDS']) {
    delete process.env[key];
  }
  clearIndices(path.join(root, '.bowman'));
  await fs.remove(root);
});

const cookie = (token: string) => `${AGENT_COOKIE}=${encodeURIComponent(token)}`;

function openSocket(pathname: string, headers: Record<string, string>) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}${pathname}`, { headers });
  return new Promise<{ ws: WebSocket } | { status: number }>((resolve) => {
    ws.once('open', () => resolve({ ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.once('error', () => resolve({ status: -1 }));
  });
}

const reply = (ws: WebSocket, message: string) =>
  new Promise<string>((resolve) => {
    ws.once('message', (data) => resolve(String(data)));
    ws.send(message);
  });

test('only an admin token becomes the agent cookie, HttpOnly and SameSite=Strict', async () => {
  const issue = (token?: string) =>
    fetch(`${base}/auth/agent-cookie`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await issue()).status, 403);
  assert.equal((await issue(writerToken)).status, 403);
  const granted = await issue(adminToken);
  assert.equal(granted.status, 204);
  assert.match(granted.headers.get('set-cookie')!, new RegExp(`^${AGENT_COOKIE}=.+; Path=/; HttpOnly; SameSite=Strict$`));
});

test('session HTTP reaches the agent only with an admin cookie, as a loopback client without the cookie', async () => {
  const url = `${base}/session/${sessionPort}/socket.io/?EIO=4&transport=polling`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { cookie: cookie(writerToken) } })).status, 403);
  assert.equal(seen.url, undefined, 'nothing reached the session');

  const response = await fetch(url, { headers: { cookie: cookie(adminToken), origin: base } });
  assert.equal(await response.text(), 'session');
  assert.equal(seen.url, '/socket.io/?EIO=4&transport=polling');
  assert.equal(seen.origin, `http://127.0.0.1:${sessionPort}`);
  assert.equal(seen.cookie, undefined);
});

test('broker and session WebSockets open for an admin of this origin only', async () => {
  const admin = { cookie: cookie(adminToken), origin: base };
  const broker = await openSocket('/broker', admin);
  assert.ok('ws' in broker);
  const brokerPort = process.env.PORT_BROKER_WS;
  assert.equal(await reply(broker.ws, 'hi'), `/ http://127.0.0.1:${brokerPort} hi`);
  broker.ws.close();

  const session = await openSocket(`/session/${sessionPort}/socket.io/?EIO=4`, admin);
  assert.ok('ws' in session);
  assert.equal(await reply(session.ws, 'ls'), `/socket.io/?EIO=4 http://127.0.0.1:${sessionPort} ls`);
  session.ws.close();

  assert.deepEqual(await openSocket('/broker', { origin: base }), { status: 403 });
  assert.deepEqual(await openSocket('/broker', { cookie: cookie(writerToken), origin: base }), { status: 403 });
  assert.deepEqual(await openSocket('/broker', { cookie: cookie(adminToken), origin: 'https://evil.example' }), { status: 403 });
  assert.deepEqual(await openSocket('/elsewhere', admin), { status: 404 });
});

test('routes only the broker and the session port range; the watchdog state is for admins', () => {
  const ports = { brokerWs: 5001, processStart: 7000 };
  assert.deepEqual(agentRoute('/broker', ports), { port: 5001, path: '/' });
  assert.deepEqual(agentRoute('/broker?connectionParams=1', ports), { port: 5001, path: '/?connectionParams=1' });
  assert.deepEqual(agentRoute('/session/7003/socket.io/?EIO=4', ports), { port: 7003, path: '/socket.io/?EIO=4' });
  assert.equal(agentRoute('/session/3005/sse', ports), null, 'the MCP port is not an agent');
  assert.equal(agentRoute('/session/7100/', ports), null);
  assert.equal(agentRoute('/brokerage', ports), null);
  assert.equal(neededRole('watchdog.getRuntimeState', 'query'), 'admin');
  process.env.AIMPARENCY_AGENTS = 'false';
  assert.equal(neededRole('watchdog.getRuntimeState', 'query'), 'local');
});
