import { createTRPCProxyClient, createWSClient, wsLink, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from 'wrapped-agents-broker';
import { ensureAgentCookie } from './utils/login';
import { brokerWsUrl, getRuntimeConfig } from './utils/runtime-config';

// With accounts the broker sits behind the server's port, for server admins only.
const gated = getRuntimeConfig().sameOrigin;

// Create WebSocket client for Watchdog Broker. Behind the gateway it connects
// only when a server admin opens the watchdog (anyone else is refused at /broker).
const wsClient = createWSClient({
  url: brokerWsUrl(),
  lazy: { enabled: gated, closeMs: 0 },
});

// Behind the gateway the lazy socket opens on the first operation, so holding
// operations until the agent cookie is set lets the gateway see the login.
const agentCookieLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable((observer) => {
    let subscription: { unsubscribe(): void } | undefined;
    let cancelled = false;
    void ensureAgentCookie().then(() => {
      if (!cancelled) subscription = next(op).subscribe(observer);
    });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  });

// Create tRPC client with WebSocket
export const trpcWatchdog = createTRPCProxyClient<AppRouter>({
  links: [
    ...(gated ? [agentCookieLink] : []),
    wsLink({
      client: wsClient,
    }),
  ],
});
