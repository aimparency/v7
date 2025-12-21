import { createTRPCClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'wrapped-gemini-broker';

// Create WebSocket client for Watchdog Broker
const wsClient = createWSClient({
  url: `ws://localhost:${process.env.PORT_BROKER_WS || '5001'}`,
});

// Create tRPC client with WebSocket
export const trpc = createTRPCClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});
