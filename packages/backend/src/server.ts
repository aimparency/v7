import http from 'node:http';
import { existsSync } from 'node:fs';
import { createHTTPHandler, createHTTPServer } from '@trpc/server/adapters/standalone';
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
import { forgetProjectChecks } from './storage/project.js';
import { hostedProject } from './auth/access.js';

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
  auth: authRouter,
});

export { appRouter };
export type AppRouter = typeof appRouter;

const HTTP_PORT = parseInt(process.env.PORT_BACKEND_HTTP || '3000');
const WS_PORT = parseInt(process.env.PORT_BACKEND_WS || '3001');
// Restrict binding to a single interface (e.g. Tailscale IP) when set; otherwise all interfaces.
const BIND_HOST = process.env.BIND_HOST || undefined;

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

// Hosted: one port carries the built UI, the API (/trpc, HTTP and WebSocket)
// and the MCP server (/mcp, proxied), so nginx needs a single proxy_pass.
function startHostedServer(project: string) {
  const port = parseInt(process.env.PORT || '4000');
  const mcpPort = parseInt(process.env.PORT_MCP || '3005');
  const trpcHandler = createHTTPHandler({ router: appRouter, createContext, basePath: '/trpc/' });
  const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  // sirv indexes the build when created, so without one the API still runs.
  const serveFrontend: http.RequestListener = existsSync(frontendDist)
    ? sirv(frontendDist, { single: true, dev: false })
    : (_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('The UI is not built: run `pnpm start` (it builds) or `pnpm build`.');
    };
  const runtimeConfig = JSON.stringify({ sameOrigin: true, hosted: true, project, voiceEnabled: false });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/trpc/')) return trpcHandler(req, res);
    if (url.startsWith('/mcp/')) return proxy(req, res, mcpPort);
    if (url.startsWith('/runtime-config.json')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(runtimeConfig);
    }
    serveFrontend(req, res);
  });
  const wss = new WebSocketServer({ server, path: '/trpc' });
  applyWSSHandler({ wss, router: appRouter, createContext });
  logConnections(wss);
  server.listen(port, BIND_HOST ?? '127.0.0.1', () => {
    console.log(`Hosting ${project} on http://${BIND_HOST ?? '127.0.0.1'}:${port}`);
  });
  closeOnSigterm(server, wss);
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
  const project = hostedProject();
  if (project) return startHostedServer(project);

  const server = createHTTPServer({
    router: appRouter,
    createContext,
  });

  const wss = new WebSocketServer({ port: WS_PORT, host: BIND_HOST });

  applyWSSHandler({
    wss,
    router: appRouter,
    createContext,
  });
  logConnections(wss);

  server.listen(HTTP_PORT, BIND_HOST, () => {
    console.log(`HTTP Server running on http://${BIND_HOST || 'localhost'}:${HTTP_PORT}`);
  });

  console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);
  closeOnSigterm(server, wss);

  return { server, wss };
}

const isMainModule =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== 'test' && isMainModule) {
  startServer();
}

