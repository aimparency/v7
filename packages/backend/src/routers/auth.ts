import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasAccounts, serverConfig } from 'shared/server-config';
import { t, delayedProcedure, type Context } from '../trpc.js';
import { agentsEnabled, mayCreateGraphs, viewerFor } from '../auth/access.js';
import * as accounts from '../auth/accounts.js';
import { newChallenge, verifyKeyLogin } from '../auth/browser-key.js';
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
    const { login, signUp } = serverConfig();
    return {
      login,
      agents: agentsEnabled(),
      signUp,
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

  // An automatic account chooses its name and password and so becomes permanent.
  makePermanent: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await run(() => accounts.makePermanent(signedIn(ctx.viewer?.name), input.name, input.password));
      return { success: true };
    }),

  // A token for an MCP client, which acts as this account.
  issueToken: delayedProcedure
    .input(z.object({ label: z.string().min(1).max(100).default('mcp') }))
    .mutation(async ({ ctx, input }) => ({
      token: await run(() => accounts.issueToken(signedIn(ctx.viewer?.name), input.label))
    })),

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
      canCreateGraphs: z.boolean().optional()
    }))
    .mutation(async ({ input }) => ({
      code: await run(() => accounts.createInvitation({
        kind: input.kind,
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
