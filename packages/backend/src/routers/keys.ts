import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, delayedProcedure, type Context } from '../trpc.js';
import { createKey, KeyError, listKeys, removeKey } from '../graphs/ssh-keys.js';

// The caller's own SSH keys on this server (graphs/ssh-keys.ts). Only public
// halves ever leave it; no procedure returns a private key.
function accountId(ctx: Context): string {
  const id = ctx.viewer?.id;
  if (!id) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
  return id;
}

async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof KeyError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

export const keysRouter = t.router({
  list: delayedProcedure.query(({ ctx }) => ctx.viewer?.id ? listKeys(ctx.viewer.id) : []),

  create: delayedProcedure
    .input(z.object({ label: z.string().max(200) }))
    .mutation(({ ctx, input }) => run(() => createKey(accountId(ctx), input.label))),

  remove: delayedProcedure
    .input(z.object({ id: z.string().max(50) }))
    .mutation(async ({ ctx, input }) => {
      await run(() => removeKey(accountId(ctx), input.id));
      return { success: true };
    })
});
