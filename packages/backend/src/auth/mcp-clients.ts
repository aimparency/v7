// MCP clients that ask for a login themselves: the client opens this server's
// page in a browser, the person logs in, chooses the graphs and approves, and
// the client gets a token for exactly that (OAuth 2.1 authorization code with
// PKCE, as the MCP specification asks). The MCP server speaks the protocol
// (packages/mcp/src/oauth.ts, on the SDK's router); what has to be remembered
// lives here, so the approval can happen in the UI.
//
// Clients register themselves and are kept in mcp-clients.json. Requests
// waiting for approval and codes waiting to be exchanged are short-lived and
// kept in memory: a restart only makes a client ask again.

import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { forgetServerFile, readServerFile, serverDir } from 'shared/server-config';
import { withFileLock, writeJsonAtomic } from '../storage/json.js';

const FILE = 'mcp-clients.json';
const MAX_CLIENTS = 500;
const REQUEST_MS = 10 * 60_000;
const CODE_MS = 2 * 60_000;
const MAX_WAITING = 5000;

/** What a client registered (RFC 7591), as the MCP SDK made it; only these fields matter here. */
export type McpClient = { client_id: string; client_name?: string; redirect_uris: string[]; [field: string]: unknown };

export class McpAuthError extends Error {}

const listClients = () => readServerFile(FILE, raw => ((raw ?? {}) as { clients?: McpClient[] }).clients ?? []);

export function findClient(clientId: string): McpClient | null {
  return listClients().find(client => client.client_id === clientId) ?? null;
}

/** Anyone may register a client (that is the protocol), so the list is bounded: the oldest make room. */
export async function registerClient(client: McpClient): Promise<McpClient> {
  const file = path.join(serverDir(), FILE);
  await withFileLock(file, async () => {
    forgetServerFile(FILE);
    await fs.ensureDir(path.dirname(file));
    await writeJsonAtomic(file, { clients: [...listClients().filter(known => known.client_id !== client.client_id), client].slice(-MAX_CLIENTS) });
    forgetServerFile(FILE);
  });
  return client;
}

type Request = { clientId: string; redirectUri: string; codeChallenge: string; state?: string; expires: number };
type Code = { clientId: string; redirectUri: string; codeChallenge: string; account: string; graphs?: string[]; expires: number };
const requests = new Map<string, Request>();
const codes = new Map<string, Code>();

function prune<T extends { expires: number }>(waiting: Map<string, T>, now: number) {
  for (const [id, entry] of waiting) if (entry.expires < now) waiting.delete(id);
  if (waiting.size >= MAX_WAITING) waiting.clear(); // begun by anyone: bound the map
}

/** A client's request for a login, waiting for a person to approve it in the UI. */
export function beginRequest(request: Omit<Request, 'expires'>, now = Date.now()): string {
  const client = findClient(request.clientId);
  if (!client) throw new McpAuthError('This MCP client is not registered on this server.');
  prune(requests, now);
  const id = crypto.randomBytes(18).toString('base64url');
  requests.set(id, { ...request, expires: now + REQUEST_MS });
  return id;
}

export function pendingRequest(id: string, now = Date.now()): (Request & { client: McpClient }) | null {
  const request = requests.get(id);
  const client = request && request.expires >= now ? findClient(request.clientId) : null;
  return request && client ? { ...request, client } : null;
}

function redirect(request: Request, values: Record<string, string>): string {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (request.state !== undefined) url.searchParams.set('state', request.state);
  return url.href;
}

/** The person approved: where to send their browser, carrying a code the client exchanges for a token. */
export function approveRequest(id: string, account: string, graphs: string[] | undefined, now = Date.now()): string {
  const request = pendingRequest(id, now);
  if (!request) throw new McpAuthError('This request is not waiting any more: start again from the MCP client.');
  requests.delete(id);
  prune(codes, now);
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, { clientId: request.clientId, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, account, graphs, expires: now + CODE_MS });
  return redirect(request, { code });
}

export function denyRequest(id: string): string {
  const request = pendingRequest(id);
  if (!request) throw new McpAuthError('This request is not waiting any more.');
  requests.delete(id);
  return redirect(request, { error: 'access_denied' });
}

/** The PKCE challenge the code was made for; the MCP server checks the client's verifier against it. */
export function codeChallenge(clientId: string, code: string, now = Date.now()): string {
  const entry = codes.get(code);
  if (!entry || entry.expires < now || entry.clientId !== clientId) throw new McpAuthError('This code is not valid.');
  return entry.codeChallenge;
}

/** Uses the code up: who approved, and for which graphs. */
export function redeemCode(clientId: string, code: string, redirectUri: string | undefined, now = Date.now()): { account: string; graphs?: string[]; clientName: string } {
  const entry = codes.get(code);
  codes.delete(code);
  if (!entry || entry.expires < now || entry.clientId !== clientId || (redirectUri !== undefined && redirectUri !== entry.redirectUri)) {
    throw new McpAuthError('This code is not valid.');
  }
  return { account: entry.account, graphs: entry.graphs, clientName: findClient(clientId)?.client_name ?? 'MCP client' };
}
