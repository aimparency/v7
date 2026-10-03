import { initTRPC } from '@trpc/server';
import { runWithOrigin } from './change-origin.js';

export type Context = { clientId?: string };

export const createContext = (opts?: { info?: { connectionParams?: Record<string, string | undefined> | null } }): Context => ({
  clientId: opts?.info?.connectionParams?.clientId
});

export const t = initTRPC.context<Context>().create();

// DEV_DELAY=true adds artificial latency, for testing loading states.
const DEV_DELAY_MS = process.env.DEV_DELAY === 'true' ? 300 : 0;
const delayMiddleware = t.middleware(async ({ ctx, next }) => {
  if (DEV_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, DEV_DELAY_MS));
  }
  return runWithOrigin(ctx.clientId, () => next());
});

export const delayedProcedure = t.procedure.use(delayMiddleware);
