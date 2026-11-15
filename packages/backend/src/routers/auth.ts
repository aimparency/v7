import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasAccounts, serverConfig, updateServerConfig } from 'shared/server-config';
import { t, delayedProcedure, type Context } from '../trpc.js';
import { agentsEnabled, mayCreateGraphs, viewerFor } from '../auth/access.js';
import * as accounts from '../auth/accounts.js';
import { newChallenge, verifyKeyLogin } from '../auth/browser-key.js';
import { verifyWalletLogin, walletChallenge } from '../auth/wallet.js';
import { findGraph } from '../graphs/registry.js';
import { withinLimit } from '../rate-limit.js';

const rights = { serverAdmin: z.boolean().optional(), canCreateGraphs: z.boolean().optional() };

function assertAccounts() {
  if (!hasAccounts()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This server has no accounts.' });
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
async function logIn(ctx: Context, name: string): Promise<{ token: string }> {
  const token = await accounts.issueToken(name, 'browser');
  if (ctx.session) ctx.session.token = token;
  return { token };
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
  // shows a login and the server's graphs instead of this machine's directories.
  me: delayedProcedure.query(({ ctx }) => {
    const viewer = ctx.viewer ?? viewerFor(ctx.session?.token);
    const { login, signUp, publicUrl } = serverConfig();
    return {
      login,
      // The address people reach this server at, when the operator named it (server.json).
      publicUrl: publicUrl ?? null,
      agents: agentsEnabled(),
      signUp: { ...signUp, wallet: walletEnabled() },
      name: viewer.name,
      serverAdmin: viewer.serverAdmin,
      canCreateGraphs: mayCreateGraphs(viewer),
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

  // A person makes their own account: where sign-up is open, or with an invitation.
  signUp: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000), invitation: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertMayCreateAccount(ctx);
      const account = await run(() => accounts.signUp(input.name, input.password, { open: serverConfig().signUp.open, invitation: input.invitation }));
      return logIn(ctx, account.name);
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
  // only on the graphs named here.
  issueToken: delayedProcedure
    .input(z.object({ label: z.string().min(1).max(100).default('mcp'), graphs: z.array(z.string()).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      for (const slug of input.graphs ?? []) {
        if (!findGraph(slug)) throw new TRPCError({ code: 'BAD_REQUEST', message: `No graph "${slug}" on this server.` });
      }
      return { token: await run(() => accounts.issueToken(signedIn(ctx.viewer?.name), input.label, input.graphs)) };
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
        canCreateGraphs: input.canCreateGraphs,
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
    const { publicUrl, graphCreation, signUp, guestDefaults } = serverConfig();
    return { publicUrl: publicUrl ?? null, graphCreation, signUp, notes: guestDefaults.notes };
  }),

  setServerSettings: delayedProcedure
    .input(z.object({
      // Empty: the server has no public address (no wallet login, no MCP login by itself).
      publicUrl: z.union([z.literal(''), z.string().url().max(500).refine(url => /^https?:\/\//.test(url), 'An address starts with https:// or http://')]).optional(),
      graphCreation: z.enum(['everyone', 'selected']).optional(),
      signUp: z.object({ open: z.boolean(), browserKey: z.boolean(), wallet: z.boolean() }).partial().optional(),
      notes: z.enum(['everyone', 'selected', 'nobody']).optional()
    }))
    .mutation(({ input }) => {
      assertAccounts();
      const current = serverConfig();
      const publicUrl = input.publicUrl?.replace(/\/+$/, '');
      updateServerConfig({
        ...(publicUrl ? { publicUrl } : {}),
        ...(input.graphCreation ? { graphCreation: input.graphCreation } : {}),
        ...(input.signUp ? { signUp: { ...current.signUp, ...input.signUp } } : {}),
        ...(input.notes ? { guestDefaults: { ...current.guestDefaults, notes: input.notes } } : {})
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
