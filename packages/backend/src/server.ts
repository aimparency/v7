import http from 'node:http';
import { existsSync } from 'node:fs';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import sirv from 'sirv';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { t, createContext } from './trpc.js';
import './value-recalculation.js'; // recalculates idea values after changes
import { ideaRouter } from './routers/idea.js';
import { phaseRouter } from './routers/phase.js';
import { systemRouter } from './routers/system.js';
import { voiceRouter } from './routers/voice.js';
import { graphRouter } from './routers/graph.js';
import { marketRouter } from './routers/market.js';
import { projectRouter } from './routers/project.js';
import { loopRouter } from './routers/loop.js';
import { watchdogRouter } from './routers/watchdog.js';
import { graphHealthRouter } from './routers/graph-health.js';
import { historyRouter } from './routers/history.js';
import { spinOffRouter } from './routers/spin-off.js';
import { linkedRepoRouter } from './routers/linked-repo.js';
import { gitRouter } from './routers/git.js';
import { authRouter } from './routers/auth.js';
import { activityRouter } from './routers/activity.js';
import { forgetProjectChecks } from './storage/project.js';
import { graphsRouter } from './routers/graphs.js';
import { keysRouter } from './routers/keys.js';
import { notesRouter } from './routers/notes.js';
import { agentsEnabled } from './auth/access.js';
import { followGitRemotes } from './git-follow.js';
import { hasAccounts, serverConfig } from 'shared/server-config';
import { agentRoute, isAdminRequest, issueAgentCookie, proxyAgentRequest, proxyAgentUpgrade, refuseUpgrade } from './agent-gateway.js';
import { isAllowedClientOrigin, resolveBindHost } from 'shared';

const appRouter = t.router({
  idea: ideaRouter,
  phase: phaseRouter,
  system: systemRouter,
  voice: voiceRouter,
  graph: graphRouter,
  market: marketRouter,
  project: projectRouter,
  loop: loopRouter,
  watchdog: watchdogRouter,
  graphHealth: graphHealthRouter,
  spinOff: spinOffRouter,
  linkedRepo: linkedRepoRouter,
  history: historyRouter,
  git: gitRouter,
  activity: activityRouter,
  auth: authRouter,
  graphs: graphsRouter,
  keys: keysRouter,
  notes: notesRouter,
});

export { appRouter };
export type AppRouter = typeof appRouter;

// Largest request or WebSocket message: a bulk undo of many ideas fits easily;
// without a cap one request could fill the server's memory.
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const HTTP_PORT = parseInt(process.env.PORT_BACKEND_HTTP || '3000');
const WS_PORT = parseInt(process.env.PORT_BACKEND_WS || '3001');
// An explicit interface (e.g. the Tailscale IP from `pnpm dev:host`); unset means
// loopback only.
const BIND_HOST = process.env.BIND_HOST || undefined;

// A server without login runs agents and loops for whoever asks: only pages
// from this machine (or the named host) and local programs without an Origin
// may use it. With accounts every request proves itself with its token.
function allowedOrigin(req: http.IncomingMessage) {
  return hasAccounts() || isAllowedClientOrigin(req.headers.origin, BIND_HOST);
}

// With accounts every graph is public reading: a page of any website may ask
// (the browser lets it see the answer only with these headers). No cookie
// carries a login to this API, so nothing rides along with such a request;
// writing from another website is refused in trpc.ts. True when the request
// was a preflight and is answered.
function answerCors(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!hasAccounts()) return false;
  res.setHeader('access-control-allow-origin', '*');
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' });
  res.end();
  return true;
}

function logConnections(wss: WebSocketServer) {
  wss.on('connection', (ws) => {
    forgetProjectChecks(); // a (re)opened client gets a fresh migration check
    console.log(`WebSocket connection established (${wss.clients.size})`);
    ws.once('close', () => {
      console.log(`WebSocket connection closed (${wss.clients.size})`);
    });
  });
}

function closeOnSigterm(server: { close(): unknown }, wss: WebSocketServer) {
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close();
    wss.close();
  });
}

// One port carries the built UI, the API (/trpc, HTTP and WebSocket), the MCP
// server (/mcp, proxied) and, when the server admins' agents are on, those
// agents (/broker, /session/<port>, see agent-gateway), so nginx needs a
// single proxy_pass. This is how a server for other people runs
// (AIMPARENCY_ONE_PORT=true, set by `pnpm start`).
function startOnePortServer() {
  const port = parseInt(process.env.PORT || '4000');
  const mcpPort = parseInt(process.env.PORT_MCP || '3005');
  const trpcHandler = createHTTPHandler({ router: appRouter, createContext, basePath: '/trpc/', maxBodySize: MAX_REQUEST_BYTES });
  const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  // sirv indexes the build when created, so without one the API still runs.
  const serveFrontend: http.RequestListener = existsSync(frontendDist)
    ? sirv(frontendDist, { single: true, dev: false })
    : (_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('The UI is not built: run `pnpm start` (it builds) or `pnpm build`.');
    };
  const agentPorts = {
    brokerWs: parseInt(process.env.PORT_BROKER_WS || '5001'),
    processStart: parseInt(process.env.PORT_PROCESS_START || '7000'),
  };
  // Read per request: server.json is edited while the server runs.
  const runtimeConfig = () => JSON.stringify({ sameOrigin: true, login: serverConfig().login, agents: agentsEnabled(), voiceEnabled: false });
  const refuse = (res: http.ServerResponse, message: string) => {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end(message);
  };

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/trpc/')) {
      if (!allowedOrigin(req)) return refuse(res, 'Origin not allowed');
      return answerCors(req, res) || trpcHandler(req, res);
    }
    const agents = agentsEnabled();
    const route = agents ? agentRoute(url, agentPorts) : null;
    if (route) return await isAdminRequest(req) ? proxyAgentRequest(req, res, route) : refuse(res, 'Agents are for server admins.');
    if (agents && url === '/auth/agent-cookie') return issueAgentCookie(req, res);
    // <host>/g/<slug>/mcp/...: the MCP server for that one graph.
    const graphMcp = /^\/g\/([a-z0-9-]+)(\/mcp\/[^?]*)(\?.*)?$/.exec(url);
    if (graphMcp) {
      req.url = `${graphMcp[2]}${graphMcp[3] ? `${graphMcp[3]}&` : '?'}graph=${graphMcp[1]}`;
      return proxy(req, res, mcpPort);
    }
    if (url.startsWith('/mcp/')) return proxy(req, res, mcpPort);
    if (url.startsWith('/runtime-config.json')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(runtimeConfig());
    }
    serveFrontend(req, res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST_BYTES });
  applyWSSHandler({ wss, router: appRouter, createContext });
  logConnections(wss);
  server.on('upgrade', async (req, socket, head) => {
    const url = req.url ?? '/';
    if (url.split('?')[0] === '/trpc') {
      if (!allowedOrigin(req)) return refuseUpgrade(socket);
      return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    }
    const route = agentsEnabled() ? agentRoute(url, agentPorts) : null;
    if (!route) return refuseUpgrade(socket, '404 Not Found');
    if (await isAdminRequest(req)) return proxyAgentUpgrade(req, socket, head, route);
    refuseUpgrade(socket);
  });
  const host = resolveBindHost(BIND_HOST);
  server.listen(port, host, () => {
    console.log(`Aimparency server (login: ${serverConfig().login}) on http://${host}:${port}`);
  });
  closeOnSigterm(server, wss);
  followGitRemotes(parseInt(process.env.AIMPARENCY_PULL_SECONDS || '300'));
  return { server, wss };
}

// Streams both ways, so the MCP's server-sent events pass through unbuffered.
function proxy(req: http.IncomingMessage, res: http.ServerResponse, port: number) {
  const upstream = http.request(
    { host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('The MCP server is not running.');
  });
  req.pipe(upstream);
}

export function startServer() {
  if (process.env.AIMPARENCY_ONE_PORT === 'true') return startOnePortServer();

  const host = resolveBindHost(BIND_HOST);
  const trpcHandler = createHTTPHandler({ router: appRouter, createContext, maxBodySize: MAX_REQUEST_BYTES });
  const server = http.createServer((req, res) => {
    if (!allowedOrigin(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('Origin not allowed');
    }
    if (!answerCors(req, res)) trpcHandler(req, res);
  });

  const wss = new WebSocketServer({
    port: WS_PORT,
    host,
    maxPayload: MAX_REQUEST_BYTES,
    verifyClient: ({ req }: { req: http.IncomingMessage }) => allowedOrigin(req),
  });

  applyWSSHandler({
    wss,
    router: appRouter,
    createContext,
  });
  logConnections(wss);

  server.listen(HTTP_PORT, host, () => {
    console.log(`HTTP Server running on http://${host}:${HTTP_PORT}`);
  });

  console.log(`WebSocket Server running on ws://${host}:${WS_PORT}`);
  closeOnSigterm(server, wss);

  return { server, wss };
}

const isMainModule =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== 'test' && isMainModule) {
  startServer();
}

