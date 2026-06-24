import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { WebSocket } from "ws";
import type { AppRouter } from "shared";

// Backend host defaults to localhost, but in `dev:host` mode the backend binds
// to a specific LAN/Tailscale interface — set BACKEND_WS_HOST (or BIND_HOST) so
// the MCP server can still reach it.
const backendHost = process.env.BACKEND_WS_HOST || process.env.BIND_HOST || 'localhost';

// Create WebSocket client
export const wsClient = createWSClient({
  url: `ws://${backendHost}:${process.env.PORT_BACKEND_WS || '3001'}`,
});

export const trpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })],
});
