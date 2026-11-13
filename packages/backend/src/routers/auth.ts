import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasAccounts, serverConfig } from 'shared/server-config';
import { t, delayedProcedure } from '../trpc.js';
import { agentsEnabled, mayCreateGraphs, viewerFor } from '../auth/access.js';
import * as accounts from '../auth/accounts.js';

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
    const viewer = ctx.viewer ?? viewerFor(ctx.token);
    return {
      login: serverConfig().login,
      agents: agentsEnabled(),
      name: viewer.name,
      serverAdmin: viewer.serverAdmin,
      canCreateGraphs: mayCreateGraphs(viewer)
    };
  }),

  login: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000) }))
    .mutation(async ({ input }) => {
      assertAccounts();
      const name = input.name.trim();
      if (loginBlocked(name)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many wrong passwords for this name: try again in a few minutes.' });
      }
      const token = await accounts.login(name, input.password);
      if (!token) {
        loginFailed(name);
        // Slows down guessing one by one; loginBlocked stops guessing in parallel.
        await new Promise(resolve => setTimeout(resolve, 1000));
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong name or password.' });
      }
      loginFailures.delete(name);
      return { token };
    }),

  logout: delayedProcedure.mutation(async ({ ctx }) => {
    if (ctx.token && hasAccounts()) await accounts.revokeToken(ctx.token);
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
      return { token: await accounts.issueToken(name, 'browser') };
    }),

  listAccounts: delayedProcedure.query(() => {
    assertAccounts();
    return accounts.listAccounts().map(({ name, serverAdmin, canCreateGraphs }) => ({ name, serverAdmin, canCreateGraphs }));
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
