import { initTRPC, TRPCError } from '@trpc/server';
import { isAllowedBrowserOrigin } from 'shared';
import type { IncomingMessage } from 'node:http';
import { runWithOrigin } from './change-origin.js';
import { hasAccounts } from 'shared/server-config';
import { assertAllowed, graphOf, viewerFor, type Viewer } from './auth/access.js';
import { touchAccount } from './auth/accounts.js';

// `session` is one object per connection: logging in sets its token, so the
// same WebSocket goes on as that account without reconnecting.
export type Context = {
  clientId?: string;
  address?: string;
  session?: { token?: string };
  /** The request comes from a page of another website (see foreignOrigin). */
  foreignOrigin?: boolean;
  /** The Origin of the page the request comes from, if any. */
  origin?: string;
  viewer?: Viewer;
};

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

// A page of another website: its Origin is neither this server's own address
// nor a page on the visitor's own machine (the dev frontend on its own port).
// Such pages may read a server with accounts, so that a graph can be shown
// from anywhere; they never write.
function foreignOrigin(req: IncomingMessage | undefined): boolean {
  const origin = req?.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req!.headers.host && !isAllowedBrowserOrigin(origin, process.env.BIND_HOST || undefined);
  } catch {
    return true;
  }
}

function requestOrigin(req: IncomingMessage | undefined): string | undefined {
  const origin = req?.headers.origin;
  try {
    return origin ? new URL(origin).origin : undefined;
  } catch {
    return undefined;
  }
}

// The login token comes with the WebSocket's connection params, or as a bearer
// header over HTTP (the MCP server, scripts).
export const createContext = (opts?: ContextOptions): Context => {
  const header = opts?.req?.headers.authorization;
  return {
    clientId: opts?.info?.connectionParams?.clientId,
    address: clientAddress(opts?.req),
    foreignOrigin: foreignOrigin(opts?.req),
    origin: requestOrigin(opts?.req),
    session: { token: opts?.info?.connectionParams?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined) }
  };
};

// A granted website logs in nowhere else (no further logins, no MCP approvals);
// it may give its own login back.
function mayWriteFromAfar(viewer: Viewer, path: string): boolean {
  if (viewer.site === undefined) return false;
  return path === 'auth.logout' || !/^(auth|mcpAuth)\./.test(path);
}

export const t = initTRPC.context<Context>().create({
  // With accounts, errors go to strangers: no server stack traces in them.
  errorFormatter: ({ shape }) => hasAccounts() ? { ...shape, data: { ...shape.data, stack: undefined } } : shape
});

// Pages of other websites read; they write only as an account that granted
// that very website a login here (auth.grantSite).
const accessMiddleware = t.middleware(async ({ ctx, path, type, getRawInput, next }) => {
  const graph = graphOf(await getRawInput());
  const viewer = viewerFor(ctx.session?.token, graph, ctx.origin);
  if (ctx.foreignOrigin && type === 'mutation' && hasAccounts() && !mayWriteFromAfar(viewer, path)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Other websites may read this server; they write only with a login you give them here.' });
  }
  assertAllowed(path, type, viewer, graph);
  // When it was last used decides when an automatic account is discarded (auth/discard.ts).
  if (viewer.id !== null) void touchAccount(viewer.id).catch(() => {});
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
