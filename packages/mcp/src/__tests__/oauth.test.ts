import { test } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, exchangeAuthorization, registerClient, startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { createMcpApp } from '../app.js';
import type { createBackendClient } from '../client.js';

// An MCP client logs in by itself, the way the SDK's own client does it:
// discovery, registration, the authorization page, the code, the token. The
// backend is a stand-in that remembers what the real one does (clients,
// waiting requests, codes, tokens); the person's approval is called directly.
function standInBackend() {
  const clients = new Map<string, { client_id: string; redirect_uris: string[] }>();
  const requests = new Map<string, { clientId: string; redirectUri: string; codeChallenge: string; state?: string }>();
  const codes = new Map<string, { clientId: string; codeChallenge: string; account: string }>();
  const tokens = new Map<string, string>();
  const connect = ((token?: string) => ({
    close() {},
    trpc: {
      auth: { me: { query: async () => ({ login: 'accounts' }) } },
      mcpAuth: {
        getClient: { query: async ({ clientId }: { clientId: string }) => clients.get(clientId) ?? null },
        registerClient: { mutate: async ({ client }: { client: { client_id: string; redirect_uris: string[] } }) => (clients.set(client.client_id, client), client) },
        begin: { mutate: async (request: { clientId: string; redirectUri: string; codeChallenge: string; state?: string }) => {
          const requestId = `request-${requests.size + 1}`;
          requests.set(requestId, request);
          return { requestId };
        } },
        challenge: { query: async ({ code }: { code: string }) => {
          if (!codes.has(code)) throw new Error('This code is not valid.');
          return { codeChallenge: codes.get(code)!.codeChallenge };
        } },
        exchange: { mutate: async ({ code }: { code: string }) => {
          const entry = codes.get(code);
          codes.delete(code);
          if (!entry) throw new Error('This code is not valid.');
          const issued = `token-${tokens.size + 1}`;
          tokens.set(issued, entry.account);
          return { token: issued };
        } },
        tokenInfo: { query: async () => token && tokens.has(token) ? { account: tokens.get(token)!, graphs: null } : null },
      },
    },
  })) as unknown as typeof createBackendClient;
  // What the person does on the server's page.
  const approve = (requestId: string, account: string) => {
    const request = requests.get(requestId)!;
    requests.delete(requestId);
    codes.set(`code-for-${requestId}`, { clientId: request.clientId, codeChallenge: request.codeChallenge, account });
    return `code-for-${requestId}`;
  };
  return { connect, approve };
}

const freePort = () => new Promise<number>((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => resolve(port));
  });
});

test('an MCP client without a login is sent to the server\'s page and comes back with a token', async () => {
  const backend = standInBackend();
  const port = await freePort();
  const publicUrl = `http://localhost:${port}`;
  const { app, close } = createMcpApp({ connect: backend.connect, basePath: '/mcp', publicUrl });
  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const endpoint = `${publicUrl}/mcp/login/sse`;
    const refused = await fetch(endpoint);
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get('www-authenticate')!, /resource_metadata="http:\/\/localhost:\d+\/\.well-known\/oauth-protected-resource\/mcp\/login\/sse"/);

    const resource = await discoverOAuthProtectedResourceMetadata(endpoint);
    assert.deepEqual(resource.authorization_servers, [`${publicUrl}/`]);
    const metadata = (await discoverAuthorizationServerMetadata(publicUrl))!;
    assert.equal(metadata.authorization_endpoint, `${publicUrl}/authorize`);
    assert.ok(metadata.code_challenge_methods_supported?.includes('S256'));

    const redirectUrl = 'http://localhost:9999/callback';
    const clientInformation = await registerClient(publicUrl, {
      metadata,
      clientMetadata: { client_name: 'Test client', redirect_uris: [redirectUrl], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] },
    });
    const { authorizationUrl, codeVerifier } = await startAuthorization(publicUrl, { metadata, clientInformation, redirectUrl });

    // The client opens this in a browser: it lands on the server's own page, which asks the person.
    const page = await fetch(authorizationUrl, { redirect: 'manual' });
    assert.equal(page.status, 302);
    const approval = new URL(page.headers.get('location')!);
    assert.equal(approval.origin, publicUrl);
    const requestId = approval.searchParams.get('mcp-authorize')!;

    const authorizationCode = backend.approve(requestId, 'ana');
    await assert.rejects(exchangeAuthorization(publicUrl, { metadata, clientInformation, authorizationCode, codeVerifier: 'not-the-verifier-this-code-was-made-for-0000', redirectUri: redirectUrl }));
    const tokens = await exchangeAuthorization(publicUrl, { metadata, clientInformation, authorizationCode, codeVerifier, redirectUri: redirectUrl });
    assert.equal(tokens.token_type.toLowerCase(), 'bearer');
    await assert.rejects(exchangeAuthorization(publicUrl, { metadata, clientInformation, authorizationCode, codeVerifier, redirectUri: redirectUrl }), 'a code works once');

    // With the token the session opens; a made-up token does not.
    const abort = new AbortController();
    const session = await fetch(endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: abort.signal });
    assert.equal(session.status, 200);
    assert.match(session.headers.get('content-type')!, /text\/event-stream/);
    abort.abort();
    assert.equal((await fetch(endpoint, { headers: { authorization: 'Bearer made-up' } })).status, 401);

    // Reading stays open for everyone at the other address.
    const open = new AbortController();
    assert.equal((await fetch(`${publicUrl}/mcp/sse`, { signal: open.signal })).status, 200);
    open.abort();
  } finally {
    close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('without a public address the server offers no client login, only the open address', async () => {
  const { app, close } = createMcpApp({ connect: standInBackend().connect });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/login/sse`)).status, 404);
    assert.equal((await fetch(`${base}/.well-known/oauth-authorization-server`)).status, 404);
  } finally {
    close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
