import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'wrapped-agents-broker';
import { buildWsUrl, getRuntimeConfig } from './utils/runtime-config';

// Create WebSocket client for Watchdog Broker. A hosted instance runs no broker,
// so there it connects only if something asks (nothing should).
const wsClient = createWSClient({
  url: buildWsUrl(getRuntimeConfig().brokerWsPort),
  lazy: { enabled: getRuntimeConfig().hosted, closeMs: 0 },
});

// Create tRPC client with WebSocket
export const trpcWatchdog = createTRPCProxyClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});
