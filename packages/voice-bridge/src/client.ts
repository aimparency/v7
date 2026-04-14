import { createTRPCProxyClient, loggerLink, wsLink, createWSClient } from '@trpc/client';
import type { AppRouter } from 'shared';
import ws from 'ws';

// Use standard Node ws for server-side client
// @ts-ignore
global.WebSocket = ws;

const WS_PORT = process.env.PORT_BACKEND_WS || '3001';

const wsClient = createWSClient({
  url: `ws://localhost:${WS_PORT}`,
});

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    loggerLink({
      enabled: (opts) =>
        (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') ||
        (opts.direction === 'down' && opts.result instanceof Error),
    }),
    wsLink({
      client: wsClient,
    }),
  ],
});
