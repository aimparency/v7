import { createTRPCProxyClient, createWSClient, wsLink, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from 'wrapped-agents-broker';
import { ensureAgentCookie } from './utils/login';
import { brokerWsUrl, getRuntimeConfig } from './utils/runtime-config';

const hosted = getRuntimeConfig().hosted;

// Create WebSocket client for Watchdog Broker. Hosted, it connects only when an
// admin opens the watchdog (a non-admin's attempt is refused at /broker).
const wsClient = createWSClient({
  url: brokerWsUrl(),
  lazy: { enabled: hosted, closeMs: 0 },
});

// Hosted: the lazy socket opens on the first operation, so holding operations
// until the agent cookie is set lets the gateway see the admin's login.
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
    ...(hosted ? [agentCookieLink] : []),
    wsLink({
      client: wsClient,
    }),
  ],
});
