import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'backend';
import { buildWsUrl, getRuntimeConfig } from './utils/runtime-config';

// Create WebSocket client
const wsClient = createWSClient({
  url: buildWsUrl(getRuntimeConfig().backendWsPort),
});

// Create tRPC client with WebSocket
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});
