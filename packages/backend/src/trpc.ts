import { initTRPC } from '@trpc/server';
import type { IncomingMessage } from 'node:http';
import { runWithOrigin } from './change-origin.js';
import { assertAllowed, viewerFor, type Viewer } from './auth/access.js';

export type Context = { clientId?: string; token?: string; viewer?: Viewer };

type ContextOptions = {
  req?: IncomingMessage;
  info?: { connectionParams?: Record<string, string | undefined> | null };
};

// The login token comes with the WebSocket's connection params, or as a bearer
// header over HTTP (the MCP server, scripts).
export const createContext = (opts?: ContextOptions): Context => {
  const header = opts?.req?.headers.authorization;
  return {
    clientId: opts?.info?.connectionParams?.clientId,
    token: opts?.info?.connectionParams?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)
  };
};

export const t = initTRPC.context<Context>().create();

const accessMiddleware = t.middleware(async ({ ctx, path, type, getRawInput, next }) => {
  const viewer = await viewerFor(ctx.token);
  assertAllowed(path, type, viewer, await getRawInput());
  return next({ ctx: { ...ctx, viewer } });
});

// DEV_DELAY=true adds artificial latency, for testing loading states.
const DEV_DELAY_MS = process.env.DEV_DELAY === 'true' ? 300 : 0;
const delayMiddleware = t.middleware(async ({ ctx, next }) => {
  if (DEV_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, DEV_DELAY_MS));
  }
  return runWithOrigin(ctx.clientId, () => next());
});

export const procedure = t.procedure.use(accessMiddleware);
export const delayedProcedure = procedure.use(delayMiddleware);
