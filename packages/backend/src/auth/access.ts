// Who may do what. On a server without login the one person at the machine may
// do everything. With accounts: everyone reads every graph; a graph's owner and
// the accounts it gave write access change it; agents, loops and server paths
// are for nobody (the server admins' agents are a separate switch).

import { TRPCError } from '@trpc/server';
import { hasAccounts, serverConfig } from 'shared/server-config';
import { resolveGraphAddress } from '../graphs/address.js';
import type { Graph } from '../graphs/registry.js';
import { resolveToken } from './accounts.js';

// What a viewer is on one graph.
const RIGHTS = ['read', 'write', 'owner'] as const;
export type GraphRight = typeof RIGHTS[number];

// What a procedure asks for: a right on the graph it names, an account, the
// server admin, or 'local' (only on a server without login).
type Need = GraphRight | 'account' | 'serverAdmin' | 'local';

export type Viewer = { id: string | null; name: string | null; serverAdmin: boolean; canCreateGraphs: boolean; permanentLogin: boolean };

const LOCAL_VIEWER: Viewer = { id: null, name: null, serverAdmin: true, canCreateGraphs: true, permanentLogin: true };
const ANONYMOUS: Viewer = { id: null, name: null, serverAdmin: false, canCreateGraphs: false, permanentLogin: false };

// The server admins' wrapped agents: off unless the operator turns them on,
// since a server admin then holds a shell on the server.
export function agentsEnabled(): boolean {
  return hasAccounts() && serverConfig().agents;
}

// Agents, loops and server paths: things a shared server must not hand out.
// The watchdog's runtime state goes to server admins when agents are on.
const LOCAL_ONLY_ROUTERS = new Set(['loop', 'watchdog', 'system', 'voice', 'market', 'spinOff']);
const LOCAL_ONLY = new Set([
  'project.openGitUrl', 'project.discoverLocalProjects', 'project.inspectPath', 'project.injectAgentInstructions',
  'linkedRepo.register'
]);
// Nothing of a graph: viewer state, or a visitor logging in or out.
const OPEN_MUTATIONS = new Set([
  'phase.setCursor', 'auth.login', 'auth.logout', 'auth.signUp', 'auth.keyChallenge', 'auth.keyLogin',
  'auth.walletChallenge', 'auth.walletLogin',
  // An MCP client's own login: the protocol's steps, open by nature (routers/mcp-auth.ts).
  'mcpAuth.registerClient', 'mcpAuth.begin', 'mcpAuth.deny', 'mcpAuth.exchange'
]);
const ACCOUNT_MUTATIONS = new Set([
  'auth.issueToken', 'auth.revokeOwnToken', 'auth.changeOwnPassword', 'auth.makePermanent', 'auth.addWallet', 'graphs.create', 'graphs.addRemote', 'keys.create', 'keys.remove',
  // Notes are the guests' part of a graph: who may leave one is the graph's setting (routers/notes.ts).
  'notes.add', 'notes.remove',
  'mcpAuth.approve'
]);
const WRITE_ROUTERS = new Set(['idea', 'phase', 'git']);
// Also derived state that costs the server (re-indexing) or is shown to every
// viewer (activity): not for visitors.
const WRITE_MUTATIONS = new Set([
  'history.restore', 'graphHealth.fixConsistency', 'project.updateMeta', 'project.setLayoutSettings',
  'project.buildSearchIndex', 'activity.record', 'linkedRepo.unregister'
]);
const OWNER_MUTATIONS = new Set(['graphs.setAccess', 'graphs.setRemoteKey', 'graphs.remove']);
// auth.listTokens answers an account about itself (its handler asks for the login).
const PUBLIC_AUTH_QUERIES = new Set(['auth.me', 'auth.listTokens']);
// Every other mutation needs a server admin, so a new one is closed until listed.

export function neededRole(path: string, type: string): Need {
  const router = path.split('.')[0]!;
  if (router === 'watchdog' && agentsEnabled()) return 'serverAdmin';
  if (LOCAL_ONLY_ROUTERS.has(router) || LOCAL_ONLY.has(path)) return 'local';
  if (type !== 'mutation') return router === 'auth' && !PUBLIC_AUTH_QUERIES.has(path) ? 'serverAdmin' : 'read';
  if (OPEN_MUTATIONS.has(path)) return 'read';
  if (ACCOUNT_MUTATIONS.has(path)) return 'account';
  if (WRITE_ROUTERS.has(router) || WRITE_MUTATIONS.has(path)) return 'write';
  if (OWNER_MUTATIONS.has(path)) return 'owner';
  return 'serverAdmin';
}

// Where things live on the server is the operator's business.
export function seesServerPaths(viewer: Viewer | undefined): boolean {
  return !hasAccounts() || viewer?.serverAdmin === true;
}

// A token limited to some graphs (an MCP client's) is the account on those
// graphs and nobody anywhere else: not on other graphs, not for the server's
// own business (accounts, creating graphs, further tokens).
export function viewerFor(token: string | undefined, graph: Graph | null = null): Viewer {
  if (!hasAccounts()) return LOCAL_VIEWER;
  const account = resolveToken(token);
  if (!account) return ANONYMOUS;
  const { scope, ...viewer } = account;
  if (scope === null) return viewer;
  if (!graph || !scope.includes(graph.slug)) return ANONYMOUS;
  return { ...viewer, serverAdmin: false, canCreateGraphs: false };
}

/** The graph a request names with `projectPath`; an unknown one is refused here, whatever the procedure would do with it. */
export function graphOf(input: unknown): Graph | null {
  if (!hasAccounts()) return null;
  const address = (input as { projectPath?: unknown } | undefined)?.projectPath;
  return typeof address === 'string' ? resolveGraphAddress(address).graph : null;
}

export function mayCreateGraphs(viewer: Viewer): boolean {
  if (viewer.serverAdmin) return true;
  return viewer.id !== null && (viewer.canCreateGraphs || serverConfig().graphCreation === 'everyone');
}

/** The viewer's right on a graph; a graph without an owner is the server admins'. */
export function rightOn(graph: Graph | null, viewer: Viewer): GraphRight {
  if (viewer.serverAdmin) return 'owner';
  if (!graph || viewer.id === null) return 'read';
  if (graph.owner === viewer.id) return 'owner';
  return graph.writers.includes(viewer.id) ? 'write' : 'read';
}

/** Why the viewer may not change this graph, or null when they may. */
export function readOnlyReason(graph: Graph | null, viewer: Viewer): string | null {
  if (rightOn(graph, viewer) !== 'read') return null;
  return viewer.name
    ? `This graph is open read-only for ${viewer.name}: ask its owner for write access.`
    : 'This graph is open read-only here: log in to edit.';
}

// The message of a refused write keeps "open read-only", which the UI already
// recognises as "editing is off here".
export function assertAllowed(path: string, type: string, viewer: Viewer, graph: Graph | null) {
  if (!hasAccounts()) return;
  const need = neededRole(path, type);
  if (need === 'local') {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${path} is not available on a server with accounts.` });
  }
  if (need === 'read' || viewer.serverAdmin) return;
  if (need === 'serverAdmin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${path} is for server admins.` });
  }
  if (need === 'account') {
    if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
    return;
  }
  const right = rightOn(graph, viewer);
  if (RIGHTS.indexOf(right) >= RIGHTS.indexOf(need)) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: readOnlyReason(graph, viewer) ?? 'Only the owner of this graph may do this.'
  });
}
