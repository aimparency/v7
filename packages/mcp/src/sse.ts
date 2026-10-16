import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { createMcpServer } from "./factory.js";
import { createBackendClient } from "./client.js";

const port = Number(process.env.PORT_MCP || 3005);
// A hosted instance proxies /mcp/* here, so the paths keep that prefix.
const basePath = process.env.MCP_BASE_PATH ?? "";
// Hosted, only the backend's proxy needs to reach this server.
const host = process.env.MCP_BIND_HOST || undefined;
const app = express();

app.use(cors());

// Store transports by session ID
const transports = new Map<string, SSEServerTransport>();

// The UI's "Copy MCP link" carries the account's token as ?token=; clients that
// can set headers may send it as a bearer instead. Each session talks to the
// backend as that account, and the backend decides what it may do.
function tokenOf(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return typeof req.query.token === "string" ? req.query.token : undefined;
}

app.get(`${basePath}/sse`, async (req, res) => {
  console.log(`New SSE connection`);
  const backend = createBackendClient(tokenOf(req));
  const server = createMcpServer(backend.trpc);
  const transport = new SSEServerTransport(`${basePath}/messages`, res);

  await server.connect(transport);

  transports.set(transport.sessionId, transport);

  res.on('close', () => {
    console.log(`SSE connection closed: ${transport.sessionId}`);
    server.close();
    backend.close();
    transports.delete(transport.sessionId);
  });
});

app.post(`${basePath}/messages`, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).send("Session not found");
    return;
  }

  await transport.handlePostMessage(req, res);
});

const listening = () => console.log(`Aimparency MCP Server running on SSE/HTTP at http://${host ?? 'localhost'}:${port}${basePath}/sse`);
if (host) app.listen(port, host, listening);
else app.listen(port, listening);
