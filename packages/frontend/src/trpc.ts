import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'backend';

// Create WebSocket client
const wsClient = createWSClient({
  url: `ws://localhost:${process.env.PORT_BACKEND_WS || '3001'}`,
});

// Create tRPC client with WebSocket
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});
