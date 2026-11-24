import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasAccounts, serverConfig, updateServerConfig } from 'shared/server-config';
import { t, delayedProcedure, type Context } from '../trpc.js';
import { agentsEnabled, mayCreateSpaces, viewerFor } from '../auth/access.js';
import * as accounts from '../auth/accounts.js';
import { newChallenge, verifyKeyLogin } from '../auth/browser-key.js';
import { verifyWalletLogin, walletChallenge } from '../auth/wallet.js';
import { findSpace, grantAccess, SpaceError, spaceBowmanPath } from '../spaces/registry.js';
import { readJsonOrNull } from '../storage/json.js';
import path from 'node:path';
import { accountFootprint, discardAccount } from '../auth/discard.js';
import { withinLimit } from '../rate-limit.js';
import { restartable, restartServer, updateServer } from '../server-restart.js';

const rights = { serverAdmin: z.boolean().optional(), canCreateSpaces: z.boolean().optional() };

function assertAccounts() {
  if (!hasAccounts()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This server has no accounts.' });
}

// The website as an origin (https://host[:port]); its pages are what a login is given to.
function siteOrigin(address: string): string {
  try {
    const url = new URL(address);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch { /* below */ }
  throw new TRPCError({ code: 'BAD_REQUEST', message: `"${address}" is not a website.` });
}

function signedIn(name: string | null | undefined): string {
  if (!name) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
  return name;
}

// Account errors are the caller's to read ("exists already", "last server admin").
async function run<T>(action: () => Promise<T>): Promise<T> {
  assertAccounts();
  try {
    return await action();
  } catch (error) {
    if (error instanceof accounts.AccountError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

// A fresh login for this account. Over a WebSocket the connection goes on as
// that account from here; the browser keeps the token for its next connection.
// A deleted account that logs in again is back (restored: the UI says so).
async function logIn(ctx: Context, name: string): Promise<{ token: string; restored: boolean }> {
  const restored = await accounts.cancelDeletion(name);
  const token = await accounts.issueToken(name, 'browser');
  if (ctx.session) ctx.session.token = token;
  return { token, restored };
}

// An invitation to a space, taken: the account reads or writes it. Returns its slug.
async function takeGrant(grant: accounts.InvitationGrant | null, accountId: string): Promise<string | null> {
  if (!grant) return null;
  try {
    return (await grantAccess(grant.space, accountId, grant.right)).slug;
  } catch (error) {
    if (error instanceof SpaceError) throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    throw error;
  }
}

// New accounts from one address per hour: sign-ups and automatic accounts together.
function assertMayCreateAccount(ctx: Context) {
  if (!withinLimit('new-account', ctx.address ?? 'unknown', serverConfig().limits.accountsPerAddressPerHour)) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many new accounts from this address: try again in an hour.' });
  }
}

// Wallet login needs the server to know its own address: a signature is only
// accepted for it (see auth/wallet.ts).
const walletEnabled = () => hasAccounts() && serverConfig().signUp.wallet && serverConfig().publicUrl !== undefined;

function walletUrl(): string {
  if (!walletEnabled()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This server offers no login with a wallet.' });
  return serverConfig().publicUrl!;
}

async function signedWallet(input: { message: string; signature: string }): Promise<string> {
  const address = await verifyWalletLogin(walletUrl(), input.message, input.signature);
  if (!address) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The wallet\'s signature does not fit the message this server wrote.' });
  return address;
}

// Wrong passwords per name within the window; at the limit that name's logins
// pause until the window ends. In memory: a restart forgets.
const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_FAILURE_WINDOW_MS = 10 * 60_000;
const loginFailures = new Map<string, { count: number; since: number }>();

function loginBlocked(name: string, now = Date.now()) {
  const failures = loginFailures.get(name);
  if (failures && now - failures.since > LOGIN_FAILURE_WINDOW_MS) loginFailures.delete(name);
  return (loginFailures.get(name)?.count ?? 0) >= LOGIN_FAILURE_LIMIT;
}

function loginFailed(name: string, now = Date.now()) {
  if (loginFailures.size > 10_000) loginFailures.clear(); // names are free text: bound the map
  const failures = loginFailures.get(name);
  if (failures) failures.count++;
  else loginFailures.set(name, { count: 1, since: now });
}

export const authRouter = t.router({
  // What kind of server this is and who is asking. login 'accounts': the UI
  // shows a login and the server's spaces instead of this machine's directories.
  me: delayedProcedure.query(({ ctx }) => {
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    const { login, signUp, publicUrl, guestDefaults } = serverConfig();
    return {
      login,
      // Who reads a space unless its owner set otherwise: the start page tells a
      // visitor to log in when spaces are for accounts.
      read: guestDefaults.read,
      // The address people reach this server at, when the operator named it (server.json).
      publicUrl: publicUrl ?? null,
      agents: agentsEnabled(),
      signUp: { ...signUp, wallet: walletEnabled() },
      name: viewer.name,
      serverAdmin: viewer.serverAdmin,
      // A server admin may restart it from the UI: a supervisor starts it again.
      restartable: viewer.serverAdmin && restartable(),
      canCreateSpaces: mayCreateSpaces(viewer),
      // False for an account held only by a key in this browser: the UI
      // recommends a name and password, since clearing the browser loses it.
      permanentLogin: viewer.id === null || viewer.permanentLogin
    };
  }),

  login: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      assertAccounts();
      const name = input.name.trim();
      if (loginBlocked(name)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many wrong passwords for this name: try again in a few minutes.' });
      }
      if (!await accounts.checkPassword(name, input.password)) {
        loginFailed(name);
        // Slows down guessing one by one; loginBlocked stops guessing in parallel.
        await new Promise(resolve => setTimeout(resolve, 1000));
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong name or password.' });
      }
      loginFailures.delete(name);
      return logIn(ctx, name);
    }),

  logout: delayedProcedure.mutation(async ({ ctx }) => {
    const token = ctx.session?.token;
    if (token && hasAccounts()) await accounts.revokeToken(token);
    if (ctx.session) ctx.session.token = undefined;
    return { success: true };
  }),

  // An account held only by this browser's key cannot be logged into again
  // once logged out: logging out discards it. What would go with it.
  ownFootprint: delayedProcedure.query(async ({ ctx }) => {
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    if (!hasAccounts() || viewer.id === null || !accounts.isAutomaticAccount(viewer.id)) return null;
    return accountFootprint(viewer.id);
  }),

  discardOwnAccount: delayedProcedure.mutation(async ({ ctx }) => {
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
    if (!accounts.isAutomaticAccount(viewer.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This account has a permanent login: log out instead.' });
    }
    await run(() => discardAccount(viewer.id!));
    if (ctx.session) ctx.session.token = undefined;
    return { success: true };
  }),

  // A person deletes their account (one with a login of its own; an automatic
  // one is discarded at once): logged out everywhere, and discarded after
  // ACCOUNT_DELETION_DAYS unless they log in again before.
  deleteOwnAccount: delayedProcedure.mutation(async ({ ctx }) => {
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
    if (accounts.isAutomaticAccount(viewer.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This account lives only in this browser: discard it instead.' });
    }
    const { purgeAt } = await run(() => accounts.scheduleDeletion(viewer.id!));
    if (ctx.session) ctx.session.token = undefined;
    return { purgeAt, days: accounts.ACCOUNT_DELETION_DAYS };
  }),

  // A person makes their own account: where sign-up is open, or with an invitation.
  signUp: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000), invitation: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertMayCreateAccount(ctx);
      // Read before the invitation is used up; signUp checks it again.
      let grant: accounts.InvitationGrant | null = null;
      try {
        grant = input.invitation ? accounts.invitationGrant(input.invitation) : null;
      } catch {
        // invalid: signUp says so
      }
      const account = await run(() => accounts.signUp(input.name, input.password, { open: serverConfig().signUp.open, invitation: input.invitation }));
      const space = await takeGrant(grant, account.id);
      return { ...await logIn(ctx, account.name), space };
    }),

  // What an invitation link offers, shown before taking it: a space (its name
  // and the right) or an account on this server.
  invitationInfo: delayedProcedure
    .input(z.object({ invitation: z.string().max(200) }))
    .query(async ({ input }) => {
      assertAccounts();
      let grant: accounts.InvitationGrant | null;
      try {
        grant = accounts.invitationGrant(input.invitation);
      } catch {
        return { valid: false, space: null, right: null };
      }
      const space = grant ? findSpace(grant.space) : null;
      if (grant && !space) return { valid: false, space: null, right: null };
      const meta = space ? await readJsonOrNull(path.join(spaceBowmanPath(space), 'meta.json')) as { name?: string } | null : null;
      return { valid: true, space: space ? { slug: space.slug, name: meta?.name ?? space.slug } : null, right: grant?.right ?? null };
    }),

  // An account that exists takes an invitation to a space.
  acceptInvitation: delayedProcedure
    .input(z.object({ invitation: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
      if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
      const grant = await run(() => accounts.redeemInvitation(input.invitation, viewer.id!));
      return { space: await takeGrant(grant, viewer.id) };
    }),

  // Login with the key in the visitor's browser: a challenge to sign, then the
  // signature. An unknown key gets a new account where the server offers that.
  keyChallenge: delayedProcedure.mutation(() => {
    assertAccounts();
    return { nonce: newChallenge() };
  }),

  keyLogin: delayedProcedure
    .input(z.object({ publicKey: z.string().max(500), nonce: z.string().max(100), signature: z.string().max(500) }))
    .mutation(async ({ ctx, input }) => {
      assertAccounts();
      if (!verifyKeyLogin(input.publicKey, input.nonce, input.signature)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The browser key did not answer the challenge.' });
      }
      let account = accounts.findAccountByKey(input.publicKey);
      if (!account) {
        if (!serverConfig().signUp.browserKey) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'This server gives no accounts automatically: log in.' });
        }
        assertMayCreateAccount(ctx);
        account = await accounts.createKeyAccount(input.publicKey);
      }
      return logIn(ctx, account.name);
    }),

  // Login with a crypto wallet: the server writes a message for this wallet,
  // the wallet signs it. An unknown wallet gets an account where sign-up is open.
  walletChallenge: delayedProcedure
    .input(z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainId: z.number().int().positive() }))
    .mutation(({ input }) => ({ message: walletChallenge(walletUrl(), input.address, input.chainId) })),

  walletLogin: delayedProcedure
    .input(z.object({ message: z.string().max(2000), signature: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const address = await signedWallet(input);
      let account = accounts.findAccountByWallet(address);
      if (!account) {
        if (!serverConfig().signUp.open) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No account on this server logs in with this wallet.' });
        }
        assertMayCreateAccount(ctx);
        account = await accounts.createWalletAccount(address);
      }
      return logIn(ctx, account.name);
    }),

  // The signed-in account takes this wallet as a login (an automatic account so becomes permanent).
  addWallet: delayedProcedure
    .input(z.object({ message: z.string().max(2000), signature: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const name = signedIn(ctx.viewer?.name);
      const address = await signedWallet(input);
      await run(() => accounts.addWallet(name, address));
      return { success: true };
    }),

  // An automatic account chooses its name and password and so becomes permanent.
  makePermanent: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await run(() => accounts.makePermanent(signedIn(ctx.viewer?.name), input.name, input.password));
      return { success: true };
    }),

  // A token for an MCP client, which acts as this account: everywhere, or
  // only on the spaces named here.
  issueToken: delayedProcedure
    .input(z.object({ label: z.string().min(1).max(100).default('mcp'), spaces: z.array(z.string()).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      for (const slug of input.spaces ?? []) {
        if (!findSpace(slug)) throw new TRPCError({ code: 'BAD_REQUEST', message: `No space "${slug}" on this server.` });
      }
      return { token: await run(() => accounts.issueToken(signedIn(ctx.viewer?.name), input.label, input.spaces)) };
    }),

  // Another Aimparency website's page (a space there shows a space of this
  // server in place) acts as this account here: the person allows it on this
  // server's own page, which hands the login to that website's page in the
  // browser (postMessage to exactly that origin). That website's server never
  // sees it. It works from that website's pages only, and does no more than
  // write what the account writes and leave notes (auth/access.ts).
  grantSite: delayedProcedure
    .input(z.object({ site: z.string().max(500) }))
    .mutation(async ({ ctx, input }) => {
      assertAccounts();
      if (ctx.foreignOrigin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Websites are allowed on this server\'s own page.' });
      const site = siteOrigin(input.site);
      return { token: await run(() => accounts.issueToken(signedIn(ctx.viewer?.name), `Website ${site}`, undefined, site)), account: ctx.viewer!.name! };
    }),

  // The logins this account handed out: its browsers and MCP clients.
  listTokens: delayedProcedure.query(({ ctx }) => {
    assertAccounts();
    return accounts.listTokens(signedIn(ctx.viewer?.name));
  }),

  revokeOwnToken: delayedProcedure
    .input(z.object({ id: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await run(() => accounts.revokeTokenById(signedIn(ctx.viewer?.name), input.id));
      return { success: true };
    }),

  changeOwnPassword: delayedProcedure
    .input(z.object({ current: z.string().max(1000), password: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      assertAccounts();
      const name = signedIn(ctx.viewer?.name);
      if (!await accounts.checkPassword(name, input.current)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The current password is wrong.' });
      }
      await run(() => accounts.setPassword(name, input.password));
      // Setting a password logs out everywhere; keep this browser logged in.
      return logIn(ctx, name);
    }),

  listAccounts: delayedProcedure.query(() => {
    assertAccounts();
    return accounts.listAccounts().map(({ id: _internal, ...account }) => account);
  }),

  listInvitations: delayedProcedure.query(() => {
    assertAccounts();
    return accounts.listInvitations();
  }),

  // The code is shown this once; the server keeps its hash.
  createInvitation: delayedProcedure
    .input(z.object({
      kind: z.enum(['once', 'permanent']),
      days: z.number().positive().max(3650).optional(),
      ...rights
    }))
    .mutation(async ({ input }) => ({
      code: await run(() => accounts.createInvitation({
        kind: input.kind,
        serverAdmin: input.serverAdmin,
        canCreateSpaces: input.canCreateSpaces,
        expiresAt: input.days ? new Date(Date.now() + input.days * 24 * 60 * 60_000).toISOString() : undefined
      }))
    })),

  removeInvitation: delayedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await run(() => accounts.removeInvitation(input.id));
      return { success: true };
    }),

  createAccount: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000), ...rights }))
    .mutation(async ({ input }) => {
      await run(() => accounts.createAccount(input.name, input.password, input));
      return { success: true };
    }),

  // The settings a server admin changes in the UI; server.json holds them and
  // the rest (port, host, agents, limits), which stays a matter of the file.
  getServerSettings: delayedProcedure.query(() => {
    assertAccounts();
    const { publicUrl, spaceCreation, signUp, guestDefaults } = serverConfig();
    return { publicUrl: publicUrl ?? null, spaceCreation, signUp, notes: guestDefaults.notes, read: guestDefaults.read };
  }),

  // Server admins only (every auth mutation not listed in auth/access.ts is).
  restartServer: delayedProcedure.mutation(() => restartServer()),
  updateServer: delayedProcedure.mutation(() => updateServer()),

  setServerSettings: delayedProcedure
    .input(z.object({
      // Empty: the server has no public address (no wallet login, no MCP login by itself).
      publicUrl: z.union([z.literal(''), z.string().url().max(500).refine(url => /^https?:\/\//.test(url), 'An address starts with https:// or http://')]).optional(),
      spaceCreation: z.enum(['everyone', 'selected']).optional(),
      signUp: z.object({ open: z.boolean(), browserKey: z.boolean(), wallet: z.boolean() }).partial().optional(),
      notes: z.enum(['everyone', 'selected', 'nobody']).optional(),
      read: z.enum(['everyone', 'accounts', 'selected']).optional()
    }))
    .mutation(({ input }) => {
      assertAccounts();
      const current = serverConfig();
      const publicUrl = input.publicUrl?.replace(/\/+$/, '');
      updateServerConfig({
        ...(publicUrl ? { publicUrl } : {}),
        ...(input.spaceCreation ? { spaceCreation: input.spaceCreation } : {}),
        ...(input.signUp ? { signUp: { ...current.signUp, ...input.signUp } } : {}),
        ...(input.notes || input.read ? { guestDefaults: { ...current.guestDefaults, ...(input.notes ? { notes: input.notes } : {}), ...(input.read ? { read: input.read } : {}) } } : {})
      }, input.publicUrl === '' ? ['publicUrl'] : []);
      return { success: true };
    }),

  setRights: delayedProcedure
    .input(z.object({ name: z.string(), ...rights }))
    .mutation(async ({ input: { name, ...changed } }) => {
      await run(() => accounts.setRights(name, changed));
      return { success: true };
    }),

  setPassword: delayedProcedure
    .input(z.object({ name: z.string(), password: z.string().max(1000) }))
    .mutation(async ({ input }) => {
      await run(() => accounts.setPassword(input.name, input.password));
      return { success: true };
    }),

  removeAccount: delayedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      await run(() => accounts.removeAccount(input.name));
      return { success: true };
    })
});
