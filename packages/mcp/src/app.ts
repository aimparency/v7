import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import express from "express";
import cors from "cors";
import { createMcpServer } from "./factory.js";
import { createOAuthProvider } from "./oauth.js";
import type { createBackendClient } from "./client.js";
import { isAllowedClientOrigin } from "shared";

export type McpAppOptions = {
  /** A backend connection as this account (no token: as anyone). */
  connect: typeof createBackendClient;
  /** A hosted server proxies /mcp/* here, so the paths keep that prefix. */
  basePath?: string;
  /** The interface this server is reachable at besides loopback (BIND_HOST), for the origin check. */
  configuredHost?: string;
  /** The server's own public address (server.json publicUrl); with it MCP clients may log in by themselves. */
  publicUrl?: string | null;
  maxSessions?: number;
};

const ACCOUNTS_ANSWER_MS = 10_000;

// The MCP server over SSE:
//   <base>/sse         open: without a token a session reads, with one it acts as that account
//   <base>/login/sse   needs a login: a client without one is told where to get it (OAuth)
//   <base>/messages    what both kinds of session post to
// and, with a public address, at the root what an MCP client's own login
// needs (discovery, /authorize, /token, /register; see oauth.ts).
export function createMcpApp({ connect, basePath = "", configuredHost, publicUrl, maxSessions = 50 }: McpAppOptions) {
  const app = express();
  // Behind the one-port server every request comes from loopback: the visitor is in X-Forwarded-For.
  app.set("trust proxy", "loopback");
  const anonymous = connect();

  // Without login every session acts with the full rights of this machine's
  // backend, so a browser page from anywhere else must not reach it (MCP clients
  // send no Origin). With accounts, requests arrive through the server's own
  // origin and the backend checks what each caller's token may do. The backend
  // says which of the two it is; while it does not answer, only local callers get in.
  let accounts: { at: number; answer: Promise<boolean> } | undefined;
  const backendHasAccounts = () => {
    if (!accounts || Date.now() - accounts.at > ACCOUNTS_ANSWER_MS) {
      accounts = { at: Date.now(), answer: anonymous.trpc.auth.me.query().then(({ login }) => login === "accounts", () => false) };
    }
    return accounts.answer;
  };
  app.use(async (req, res, next) => {
    if (isAllowedClientOrigin(req.headers.origin, configuredHost) || await backendHasAccounts()) return next();
    res.status(403).send("Origin not allowed");
  });
  app.use(cors());

  const transports = new Map<string, SSEServerTransport>();

  // The UI's MCP link carries the account's token as ?token=; clients that
  // can set headers (and those that logged in by themselves) send it as a
  // bearer. Each session talks to the backend as that account, and the backend
  // decides what it may do.
  const tokenOf = (req: express.Request): string | undefined => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7);
    return typeof req.query.token === "string" ? req.query.token : undefined;
  };

  const openSession: express.RequestHandler = async (req, res) => {
    // Each session holds a backend connection: enough for a team's clients,
    // not for one caller to exhaust the server.
    if (transports.size >= maxSessions) {
      res.status(503).send("Too many MCP sessions");
      return;
    }
    const backend = connect(tokenOf(req));
    // ?graph=<slug>: the session came through that graph's address (the one-port server adds it).
    const server = createMcpServer(backend.trpc, typeof req.query.graph === "string" ? req.query.graph : undefined);
    const transport = new SSEServerTransport(`${basePath}/messages`, res);
    await server.connect(transport);
    transports.set(transport.sessionId, transport);
    res.on("close", () => {
      server.close();
      backend.close();
      transports.delete(transport.sessionId);
    });
  };

  app.get(`${basePath}/sse`, openSession);

  if (publicUrl) {
    const resource = new URL(`${basePath}/login/sse`, publicUrl);
    const provider = createOAuthProvider(anonymous.trpc, publicUrl, async (token) => {
      const asToken = connect(token);
      try {
        return await asToken.trpc.mcpAuth.tokenInfo.query();
      } finally {
        asToken.close();
      }
    });
    app.use(mcpAuthRouter({ provider, issuerUrl: new URL(publicUrl), resourceServerUrl: resource, resourceName: "Aimparency" }));
    app.get(`${basePath}/login/sse`, requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) }), openSession);
  }

  app.post(`${basePath}/messages`, async (req, res) => {
    const transport = transports.get(req.query.sessionId as string);
    if (!transport) {
      res.status(404).send("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  return { app, close: () => anonymous.close() };
}
