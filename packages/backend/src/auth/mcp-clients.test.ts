// An MCP client's own login: it registers, asks, a person approves in the UI
// for chosen spaces, and the client exchanges a one-time code for a token.
import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { updateServerConfig } from 'shared/server-config';
import { appRouter } from '../server';
import { clearIndices } from '../search';
import { listSpaces } from '../spaces/registry';
import * as accounts from './accounts';

let root = '';
const localServerDir = process.env.AIMPARENCY_SERVER_DIR;
const mcpServer = () => appRouter.createCaller({ session: {} }); // the MCP server asks without a login
const client = { client_id: 'client-1', client_name: 'Coding agent', redirect_uris: ['http://localhost:7777/callback'], token_endpoint_auth_method: 'none' };
const request = { clientId: 'client-1', redirectUri: 'http://localhost:7777/callback', codeChallenge: 'the-challenge', state: 'xyz' };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-mcp-auth-'));
  process.env.AIMPARENCY_SERVER_DIR = root;
  updateServerConfig({ login: 'accounts' });
});

afterEach(async () => {
  for (const space of listSpaces()) clearIndices(space.path);
  process.env.AIMPARENCY_SERVER_DIR = localServerDir;
  await fs.remove(root);
});

test('a person approves a client for chosen spaces, and the client gets a token for exactly those', async () => {
  await accounts.createAccount('ana', 'ana password');
  const ana = appRouter.createCaller({ session: { token: (await accounts.login('ana', 'ana password'))! } });
  const first = (await ana.spaces.create({ name: 'First' })).slug;
  const second = (await ana.spaces.create({ name: 'Second' })).slug;

  await assert.rejects(mcpServer().mcpAuth.begin(request), /not registered/);
  assert.deepEqual(await mcpServer().mcpAuth.registerClient({ client }), client);
  assert.equal((await mcpServer().mcpAuth.getClient({ clientId: 'client-1' }))?.client_name, 'Coding agent');
  const { requestId } = await mcpServer().mcpAuth.begin(request);
  assert.deepEqual(await ana.mcpAuth.pending({ requestId }), { clientName: 'Coding agent', redirectHost: 'localhost:7777' });

  await assert.rejects(mcpServer().mcpAuth.approve({ requestId }), /Log in first/);
  await assert.rejects(ana.mcpAuth.approve({ requestId, spaces: ['unknown'] }), /No space "unknown"/);
  const redirect = new URL((await ana.mcpAuth.approve({ requestId, spaces: [first] })).redirectTo);
  assert.equal(redirect.origin + redirect.pathname, 'http://localhost:7777/callback');
  assert.equal(redirect.searchParams.get('state'), 'xyz');
  const code = redirect.searchParams.get('code')!;
  assert.equal(await ana.mcpAuth.pending({ requestId }), null, 'approved once');

  // The MCP server checks the client's PKCE proof against this, then exchanges the code.
  assert.deepEqual(await mcpServer().mcpAuth.challenge({ clientId: 'client-1', code }), { codeChallenge: 'the-challenge' });
  await assert.rejects(mcpServer().mcpAuth.challenge({ clientId: 'someone-else', code }), /not valid/);
  const { token } = await mcpServer().mcpAuth.exchange({ clientId: 'client-1', code, redirectUri: request.redirectUri });
  await assert.rejects(mcpServer().mcpAuth.exchange({ clientId: 'client-1', code }), /not valid/);

  const agent = appRouter.createCaller({ session: { token } });
  assert.deepEqual(await agent.mcpAuth.tokenInfo(), { account: 'ana', spaces: [first] });
  await agent.idea.createFloatingIdea({ space: first, idea: { text: 'From the agent' } });
  await assert.rejects(agent.idea.createFloatingIdea({ space: second, idea: { text: 'Not chosen' } }), /log in to edit/);
  assert.deepEqual((await ana.auth.listTokens()).map(({ label, spaces }) => ({ label, spaces })).at(-1), { label: 'Coding agent', spaces: [first] });
  assert.equal(await mcpServer().mcpAuth.tokenInfo(), null);
});

test('a denied request sends the client an error and no code; a wrong redirect address gets no token', async () => {
  await accounts.createAccount('ana', 'ana password');
  const ana = appRouter.createCaller({ session: { token: (await accounts.login('ana', 'ana password'))! } });
  await mcpServer().mcpAuth.registerClient({ client });

  const denied = await mcpServer().mcpAuth.begin(request);
  const redirect = new URL((await ana.mcpAuth.deny(denied)).redirectTo);
  assert.equal(redirect.searchParams.get('error'), 'access_denied');
  assert.equal(redirect.searchParams.get('code'), null);
  await assert.rejects(ana.mcpAuth.approve(denied), /not waiting any more/);

  const { requestId } = await mcpServer().mcpAuth.begin(request);
  const code = new URL((await ana.mcpAuth.approve({ requestId })).redirectTo).searchParams.get('code')!;
  await assert.rejects(mcpServer().mcpAuth.exchange({ clientId: 'client-1', code, redirectUri: 'http://localhost:7777/elsewhere' }), /not valid/);
});
