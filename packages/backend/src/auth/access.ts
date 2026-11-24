// Who may do what. On a server without login the one person at the machine may
// do everything. With accounts: a space is read by whom its setting names
// (everyone, every account, or selected accounts; mayRead); its owner and the
// accounts it gave write access change it; agents, loops and server paths are
// for nobody (the server admins' agents are a separate switch).

import { TRPCError } from '@trpc/server';
import { hasAccounts, serverConfig } from 'shared/server-config';
import { resolveSpaceAddress } from '../spaces/address.js';
import { slugsOf, type Space } from '../spaces/registry.js';
import { resolveToken } from './accounts.js';

// What a viewer is on one space.
// Each includes the ones before it. manage: write, and choose who else reads
// and writes (invitations too); the owner alone chooses the managers, who
// reads at all, and the space's address, key and existence.
const RIGHTS = ['read', 'write', 'manage', 'owner'] as const;
export type SpaceRight = typeof RIGHTS[number];

// What a procedure asks for: a right on the space it names, an account, the
// server admin, or 'local' (only on a server without login).
type Need = SpaceRight | 'account' | 'serverAdmin' | 'local';

export type Viewer = {
  id: string | null; name: string | null; serverAdmin: boolean; canCreateSpaces: boolean; permanentLogin: boolean;
  /** Logged in by a website the account granted (auth.grantSite): that website's origin. */
  site?: string;
};

const LOCAL_VIEWER: Viewer = { id: null, name: null, serverAdmin: true, canCreateSpaces: true, permanentLogin: true };
const ANONYMOUS: Viewer = { id: null, name: null, serverAdmin: false, canCreateSpaces: false, permanentLogin: false };

// The server admins' wrapped agents: off unless the operator turns them on,
// since a server admin then holds a shell on the server.
export function agentsEnabled(): boolean {
  return hasAccounts() && serverConfig().agents;
}

// Agents, loops and server paths: things a shared server must not hand out.
// The watchdog's runtime state and the agents' Stop hook go to server admins when agents are on.
const LOCAL_ONLY_ROUTERS = new Set(['loop', 'watchdog', 'continueHook', 'system', 'voice', 'market', 'spinOff']);
const LOCAL_ONLY = new Set([
  'project.openGitUrl', 'project.discoverLocalProjects', 'project.inspectPath', 'project.injectAgentInstructions',
  'linkedRepo.register'
]);
// Nothing of a space: viewer state, or a visitor logging in or out.
const OPEN_MUTATIONS = new Set([
  'phase.setCursor', 'auth.login', 'auth.logout', 'auth.signUp', 'auth.keyChallenge', 'auth.keyLogin',
  'auth.walletChallenge', 'auth.walletLogin',
  // An MCP client's own login: the protocol's steps, open by nature (routers/mcp-auth.ts).
  'mcpAuth.registerClient', 'mcpAuth.begin', 'mcpAuth.deny', 'mcpAuth.exchange'
]);
const ACCOUNT_MUTATIONS = new Set([
  'auth.issueToken', 'auth.grantSite', 'auth.acceptInvitation', 'auth.revokeOwnToken', 'auth.changeOwnPassword', 'auth.makePermanent', 'auth.addWallet', 'auth.discardOwnAccount', 'auth.deleteOwnAccount', 'spaces.create', 'spaces.addRemote',
  // Its handler asks for the owner: a deleted space is no `space` the access check could resolve.
  'spaces.restore', 'keys.create', 'keys.remove',
  // Notes are the guests' part of a space: who may leave one is the space's setting (routers/notes.ts).
  'notes.add', 'notes.remove',
  'mcpAuth.approve'
]);
const WRITE_ROUTERS = new Set(['idea', 'phase', 'git']);
// Also derived state that costs the server (re-indexing) or is shown to every
// viewer (activity): not for visitors.
const WRITE_MUTATIONS = new Set([
  'history.restore', 'spaceHealth.fixConsistency', 'project.updateMeta', 'project.setLayoutSettings',
  'project.buildSearchIndex', 'activity.record', 'linkedRepo.unregister', 'linkedRepo.linkHost', 'linkedRepo.rename',
  // Accepting an offer links the offered space into the space (routers/notes.ts).
  'notes.acceptOffer'
]);
const OWNER_MUTATIONS = new Set(['spaces.setRemoteKey', 'spaces.setSlug', 'spaces.remove']);
// Their handlers keep the owner's part of them to the owner (routers/spaces.ts).
const MANAGE_MUTATIONS = new Set(['spaces.setAccess', 'spaces.invite', 'spaces.removeInvitation']);
// What a website the account granted may do beyond writing its spaces; its
// account (password, tokens, further websites) stays on this server's own pages.
const SITE_ACCOUNT_MUTATIONS = new Set(['notes.add', 'notes.remove']);
// auth.listTokens answers an account about itself (its handler asks for the login).
const PUBLIC_AUTH_QUERIES = new Set(['auth.me', 'auth.listTokens', 'auth.ownFootprint', 'auth.invitationInfo']);
// Every other mutation needs a server admin, so a new one is closed until listed.

export function neededRole(path: string, type: string): Need {
  const router = path.split('.')[0]!;
  if ((router === 'watchdog' || router === 'continueHook') && agentsEnabled()) return 'serverAdmin';
  if (LOCAL_ONLY_ROUTERS.has(router) || LOCAL_ONLY.has(path)) return 'local';
  if (type !== 'mutation') return router === 'auth' && !PUBLIC_AUTH_QUERIES.has(path) ? 'serverAdmin' : 'read';
  if (OPEN_MUTATIONS.has(path)) return 'read';
  if (ACCOUNT_MUTATIONS.has(path)) return 'account';
  if (WRITE_ROUTERS.has(router) || WRITE_MUTATIONS.has(path)) return 'write';
  if (OWNER_MUTATIONS.has(path)) return 'owner';
  if (MANAGE_MUTATIONS.has(path)) return 'manage';
  return 'serverAdmin';
}

// Where things live on the server is the operator's business.
export function seesServerPaths(viewer: Viewer | undefined): boolean {
  return !hasAccounts() || viewer?.serverAdmin === true;
}

// A token limited to some spaces (an MCP client's) is the account on those
// spaces and nobody anywhere else: not on other spaces, not for the server's
// own business (accounts, creating spaces, further tokens).
// A token granted to another website is the account only on that website's
// pages (`origin`, the request's Origin); there it writes what the account
// writes, and leaves notes, but does no more of the server's own business.
export function viewerFor(token: string | undefined, space: Space | null = null, origin?: string): Viewer {
  if (!hasAccounts()) return LOCAL_VIEWER;
  const account = resolveToken(token);
  if (!account) return ANONYMOUS;
  const { scope, site, ...viewer } = account;
  if (site !== null) {
    if (origin !== site) return ANONYMOUS;
    return { ...viewer, serverAdmin: false, canCreateSpaces: false, site };
  }
  if (scope === null) return viewer;
  if (!space || !slugsOf(space).some(slug => scope.includes(slug))) return ANONYMOUS;
  return { ...viewer, serverAdmin: false, canCreateSpaces: false };
}

/** The space a request names with `space`; an unknown one is refused here, whatever the procedure would do with it. */
export function spaceOf(input: unknown): Space | null {
  if (!hasAccounts()) return null;
  const address = (input as { space?: unknown } | undefined)?.space;
  return typeof address === 'string' ? resolveSpaceAddress(address).space : null;
}

export function mayCreateSpaces(viewer: Viewer): boolean {
  if (viewer.serverAdmin) return true;
  return viewer.id !== null && (viewer.canCreateSpaces || serverConfig().spaceCreation === 'everyone');
}

/** The viewer's right on a space; a space without an owner is the server admins'. */
export function rightOn(space: Space | null, viewer: Viewer): SpaceRight {
  if (viewer.serverAdmin) return 'owner';
  if (!space || viewer.id === null) return 'read';
  if (space.owner === viewer.id) return 'owner';
  if (space.managers?.includes(viewer.id)) return 'manage';
  return space.writers.includes(viewer.id) ? 'write' : 'read';
}

/** Who reads the space besides its owner and writers: its own setting, else the server's default. */
export const readSettingOf = (space: Space) => space.read ?? serverConfig().guestDefaults.read;

/**
 * Whether the viewer may see the space at all. Its owner, writers and the
 * server admins always; others by the space's read setting. Asked of every
 * request that names a space, whatever else it needs.
 */
export function mayRead(space: Space | null, viewer: Viewer): boolean {
  if (!hasAccounts() || !space) return true;
  if (rightOn(space, viewer) !== 'read') return true;
  const setting = readSettingOf(space);
  if (setting === 'everyone') return true;
  if (viewer.id === null) return false;
  return setting === 'accounts' || (space.readers ?? []).includes(viewer.id);
}

// "log in" for a visitor (the UI offers the login), "ask the owner" for an account.
function refuseReading(viewer: Viewer): never {
  if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'This space is open to accounts only: log in to see it.' });
  throw new TRPCError({ code: 'FORBIDDEN', message: 'This space is open only to the accounts its owner selected: ask its owner for access.' });
}

/** Why the viewer may not change this space, or null when they may. */
export function readOnlyReason(space: Space | null, viewer: Viewer): string | null {
  if (rightOn(space, viewer) !== 'read') return null;
  return viewer.name
    ? `This space is open read-only for ${viewer.name}: ask its owner for write access.`
    : 'This space is open read-only here: log in to edit.';
}

// The message of a refused write keeps "open read-only", which the UI already
// recognises as "editing is off here".
export function assertAllowed(path: string, type: string, viewer: Viewer, space: Space | null) {
  if (!hasAccounts()) return;
  const need = neededRole(path, type);
  if (need === 'local') {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${path} is not available on a server with accounts.` });
  }
  // Nothing of a space, not even a note on it, for whom may not read it.
  if (!mayRead(space, viewer)) refuseReading(viewer);
  if (need === 'read' || viewer.serverAdmin) return;
  if (need === 'serverAdmin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${path} is for server admins.` });
  }
  if (need === 'account') {
    if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
    if (viewer.site !== undefined && !SITE_ACCOUNT_MUTATIONS.has(path)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `${viewer.site} may not do this for your account: do it on this server's own page.` });
    }
    return;
  }
  if (viewer.site !== undefined && (need === 'owner' || need === 'manage')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner of this space may do this, on this server\'s own page.' });
  }
  const right = rightOn(space, viewer);
  if (RIGHTS.indexOf(right) >= RIGHTS.indexOf(need)) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: readOnlyReason(space, viewer) ?? 'Only the owner of this space may do this.'
  });
}
