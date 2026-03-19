import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'wrapped-agents-broker';
import { buildWsUrl, getRuntimeConfig } from './utils/runtime-config';

// Create WebSocket client for Watchdog Broker
const wsClient = createWSClient({
  url: buildWsUrl(getRuntimeConfig().brokerWsPort),
});

// Create tRPC client with WebSocket
export const trpcWatchdog = createTRPCProxyClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});
