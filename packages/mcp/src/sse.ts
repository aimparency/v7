import { createMcpApp } from "./app.js";
import { createBackendClient } from "./client.js";
import { resolveBindHost } from "shared";

const port = Number(process.env.PORT_MCP || 3005);
// Loopback unless named: behind the one-port server only its proxy needs to
// reach this server (MCP_BIND_HOST); `pnpm dev:host` opens it to BIND_HOST like the rest.
const configuredHost = process.env.MCP_BIND_HOST || process.env.BIND_HOST || undefined;
const host = resolveBindHost(configuredHost);
const basePath = process.env.MCP_BASE_PATH ?? "";

// The backend knows the server's public address (server.json); with one, MCP
// clients may log in by themselves. Asked once: the answer waits for the
// backend to be up, like everything this server does.
const startup = createBackendClient();
const { publicUrl } = await startup.trpc.auth.me.query();
startup.close();

const { app } = createMcpApp({
  connect: createBackendClient,
  basePath,
  configuredHost,
  publicUrl,
  maxSessions: Number(process.env.MCP_MAX_SESSIONS || 50),
});

app.listen(port, host, () => console.log(`Aimparency MCP Server running on SSE/HTTP at http://${host}:${port}${basePath}/sse`));
