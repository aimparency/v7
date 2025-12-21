import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { WebSocket } from "ws";
import type { AppRouter } from "backend";

// Create WebSocket client
const wsClient = createWSClient({
  url: `ws://localhost:${process.env.PORT_BACKEND_WS || '3001'}`,
});

export const trpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })],
});
