import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { WebSocket } from "ws";
import type { AppRouter } from "backend";

// Create tRPC client to backend
export const wsClient = createWSClient({
  url: "ws://localhost:3001",
  WebSocket: WebSocket as any,
});

export const trpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })],
});
