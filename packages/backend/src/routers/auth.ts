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

export const authRouter = t.router({
  // hosted: whether this instance has accounts at all (the UI shows a login then).
  me: delayedProcedure.query(({ ctx }) => ({
    hosted: hostedProject() !== null,
    project: hostedProject(),
    name: ctx.viewer?.name ?? null,
    role: ctx.viewer?.role ?? 'admin'
  })),

  login: delayedProcedure
    .input(z.object({ name: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const token = await accounts.login(project(), input.name.trim(), input.password);
      if (!token) {
        // Slows down guessing; enough for one house.
        await new Promise(resolve => setTimeout(resolve, 1000));
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong name or password.' });
      }
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
