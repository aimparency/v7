import { initTRPC } from '@trpc/server';
import type { IncomingMessage } from 'node:http';
import { runWithOrigin } from './change-origin.js';
import { hasAccounts } from 'shared/server-config';
import { assertAllowed, viewerFor, type Viewer } from './auth/access.js';

// `session` is one object per connection: logging in sets its token, so the
// same WebSocket goes on as that account without reconnecting.
export type Context = { clientId?: string; address?: string; session?: { token?: string }; viewer?: Viewer };

type ContextOptions = {
  req?: IncomingMessage;
  info?: { connectionParams?: Record<string, string | undefined> | null };
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Whom limits count against. Behind a proxy on this machine (nginx) the visitor
// is the last entry of X-Forwarded-For, the one the proxy itself added.
function clientAddress(req: IncomingMessage | undefined): string | undefined {
  const remote = req?.socket?.remoteAddress;
  const forwarded = req?.headers['x-forwarded-for'];
  if (remote && LOOPBACK.has(remote) && typeof forwarded === 'string') return forwarded.split(',').pop()!.trim() || remote;
  return remote;
}

// The login token comes with the WebSocket's connection params, or as a bearer
// header over HTTP (the MCP server, scripts).
export const createContext = (opts?: ContextOptions): Context => {
  const header = opts?.req?.headers.authorization;
  return {
    clientId: opts?.info?.connectionParams?.clientId,
    address: clientAddress(opts?.req),
    session: { token: opts?.info?.connectionParams?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined) }
  };
};

export const t = initTRPC.context<Context>().create({
  // With accounts, errors go to strangers: no server stack traces in them.
  errorFormatter: ({ shape }) => hasAccounts() ? { ...shape, data: { ...shape.data, stack: undefined } } : shape
});

const accessMiddleware = t.middleware(async ({ ctx, path, type, getRawInput, next }) => {
  const viewer = viewerFor(ctx.session?.token);
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
