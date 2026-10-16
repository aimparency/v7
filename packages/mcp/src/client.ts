import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { inferRouterInputs } from "@trpc/server";
import { WebSocket } from "ws";
import type { AppRouter } from "backend";

// Backend host defaults to localhost, but in `dev:host` mode the backend binds
// to a specific LAN/Tailscale interface — set BACKEND_WS_HOST (or BIND_HOST) so
// the MCP server can still reach it. A hosted instance serves the WebSocket on
// its single port, under /trpc: BACKEND_WS_URL names it whole.
const backendHost = process.env.BACKEND_WS_HOST || process.env.BIND_HOST || 'localhost';
const backendWsUrl = process.env.BACKEND_WS_URL || `ws://${backendHost}:${process.env.PORT_BACKEND_WS || '3001'}`;

// A token acts as that account on a hosted instance; without one the backend
// grants what it grants anyone (everything locally, reading when hosted).
export function createBackendClient(token?: string) {
  const wsClient = createWSClient({
    url: backendWsUrl,
    WebSocket: WebSocket as never,
    connectionParams: token ? { token } : undefined,
  });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: wsClient })] });
  return { trpc, close: () => wsClient.close() };
}

export type BackendClient = ReturnType<typeof createBackendClient>["trpc"];
export type BackendInputs = inferRouterInputs<AppRouter>;
