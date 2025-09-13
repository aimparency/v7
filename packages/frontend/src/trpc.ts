import { createTRPCClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'shared';

// Create WebSocket client
const wsClient = createWSClient({
  url: 'ws://localhost:3001',
});

// Create tRPC client with WebSocket
export const trpc = createTRPCClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});