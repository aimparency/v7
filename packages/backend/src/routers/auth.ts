import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, delayedProcedure } from '../trpc.js';
import { hostedProject } from '../auth/access.js';
import * as accounts from '../auth/accounts.js';

const role = z.enum(accounts.ROLES);

function project(): string {
  const hosted = hostedProject();
  if (!hosted) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Accounts exist on hosted instances only.' });
  return hosted;
}

function signedIn(name: string | null | undefined): string {
  if (!name) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
  return name;
}

// Account errors are the caller's to read ("exists already", "last admin").
async function run<T>(action: () => Promise<T>): Promise<T> {
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
  // hosted: whether this instance has accounts at all (the UI shows a login then).
  me: delayedProcedure.query(({ ctx }) => ({
    hosted: hostedProject() !== null,
    project: hostedProject(),
    name: ctx.viewer?.name ?? null,
    role: ctx.viewer?.role ?? 'admin'
  })),

  login: delayedProcedure
    .input(z.object({ name: z.string().max(200), password: z.string().max(1000) }))
    .mutation(async ({ input }) => {
      const name = input.name.trim();
      if (loginBlocked(name)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many wrong passwords for this name: try again in a few minutes.' });
      }
      const token = await accounts.login(project(), name, input.password);
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
    if (ctx.token) await accounts.revokeToken(project(), ctx.token);
    return { success: true };
  }),

  // A token for an MCP client, which acts as this account.
  issueToken: delayedProcedure
    .input(z.object({ label: z.string().min(1).default('mcp') }))
    .mutation(async ({ ctx, input }) => ({
      token: await run(() => accounts.issueToken(project(), signedIn(ctx.viewer?.name), input.label))
    })),

  changeOwnPassword: delayedProcedure
    .input(z.object({ current: z.string(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const name = signedIn(ctx.viewer?.name);
      if (!await accounts.checkPassword(project(), name, input.current)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The current password is wrong.' });
      }
      await run(() => accounts.setPassword(project(), name, input.password));
      // Setting a password logs out everywhere; keep this browser logged in.
      return { token: await accounts.issueToken(project(), name, 'browser') };
    }),

  listUsers: delayedProcedure.query(() => accounts.listUsers(project())),

  createUser: delayedProcedure
    .input(z.object({ name: z.string(), role, password: z.string() }))
    .mutation(async ({ input }) => {
      await run(() => accounts.createUser(project(), input.name, input.role, input.password));
      return { success: true };
    }),

  setRole: delayedProcedure
    .input(z.object({ name: z.string(), role }))
    .mutation(async ({ input }) => {
      await run(() => accounts.setRole(project(), input.name, input.role));
      return { success: true };
    }),

  setPassword: delayedProcedure
    .input(z.object({ name: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      await run(() => accounts.setPassword(project(), input.name, input.password));
      return { success: true };
    }),

  removeUser: delayedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      await run(() => accounts.removeUser(project(), input.name));
      return { success: true };
    })
});
