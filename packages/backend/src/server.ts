import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { warmupEmbedder } from './embeddings.js';
import { t, createContext } from './trpc.js';
import './value-recalculation.js'; // recalculates idea values after changes
import { ideaRouter } from './routers/idea.js';
import { phaseRouter } from './routers/phase.js';
import { systemRouter } from './routers/system.js';
import { voiceRouter } from './routers/voice.js';
import { graphRouter } from './routers/graph.js';
import { marketRouter } from './routers/market.js';
import { projectRouter } from './routers/project.js';
import { historyRouter } from './routers/history.js';
import { spinOffRouter } from './routers/spin-off.js';
import { linkedRepoRouter } from './routers/linked-repo.js';

const appRouter = t.router({
  idea: ideaRouter,
  phase: phaseRouter,
  system: systemRouter,
  voice: voiceRouter,
  graph: graphRouter,
  market: marketRouter,
  project: projectRouter,
  spinOff: spinOffRouter,
  linkedRepo: linkedRepoRouter,
  history: historyRouter,
});

export { appRouter };
export type AppRouter = typeof appRouter;

const HTTP_PORT = parseInt(process.env.PORT_BACKEND_HTTP || '3000');
const WS_PORT = parseInt(process.env.PORT_BACKEND_WS || '3001');
// Restrict binding to a single interface (e.g. Tailscale IP) when set; otherwise all interfaces.
const BIND_HOST = process.env.BIND_HOST || undefined;

export function startServer() {
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

  wss.on('connection', (ws) => {
    console.log(`WebSocket connection established (${wss.clients.size})`);
    ws.once('close', () => {
      console.log(`WebSocket connection closed (${wss.clients.size})`);
    });
  });

  server.listen(HTTP_PORT, BIND_HOST, () => {
    console.log(`HTTP Server running on http://${BIND_HOST || 'localhost'}:${HTTP_PORT}`);
  });

  // Load the embedding model up front so the first search/index doesn't pay the cold-load cost.
  warmupEmbedder().then(() => console.log('Embedding model ready'));

  console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close();
    wss.close();
  });
  
  return { server, wss };
}

const isMainModule =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== 'test' && isMainModule) {
  startServer();
}

