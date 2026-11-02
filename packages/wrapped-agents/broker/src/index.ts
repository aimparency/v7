import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { WatchdogManager, type AgentType } from './manager.js';

const agentTypeSchema = z.enum(['claude', 'gemini', 'codex', 'agy', 'grok']).default('gemini');
import cors from 'cors';
import type http from 'node:http';
import { isAllowedClientOrigin, resolveBindHost } from 'shared';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Context
export const createContext = () => ({});
type Context = ReturnType<typeof createContext>;

const t = initTRPC.context<Context>().create();

const appRouter = t.router({
  watchdog: t.router({
    start: t.procedure
      .input(z.object({ projectPath: z.string(), agentType: agentTypeSchema }))
      .mutation(async ({ input }) => {
         return await WatchdogManager.start(input.projectPath, input.agentType as AgentType);
      }),
    stop: t.procedure
      .input(z.object({ projectPath: z.string(), agentType: agentTypeSchema }))
      .mutation(async ({ input }) => {
         const success = WatchdogManager.stop(input.projectPath, input.agentType as AgentType);
         return { success };
      }),
    relaunch: t.procedure
      .input(z.object({ projectPath: z.string(), agentType: agentTypeSchema, verify: z.boolean().optional() }))
      .mutation(async ({ input }) => {
         return await WatchdogManager.relaunch(input.projectPath, input.agentType as AgentType, { verify: input.verify });
      }),
    getStatus: t.procedure
      .input(z.object({ projectPath: z.string(), agentType: agentTypeSchema }))
      .query(async ({ input }) => {
         return WatchdogManager.getStatus(input.projectPath, input.agentType as AgentType);
      }),
    keepalive: t.procedure
      .input(z.object({ projectPath: z.string(), agentType: agentTypeSchema }))
      .mutation(async ({ input }) => {
         const success = await WatchdogManager.keepalive(input.projectPath, input.agentType as AgentType);
         return { success };
      }),
    list: t.procedure
      .query(async () => {
         return WatchdogManager.list();
      }),
    // Hook notification: a main worker "halt" hook calls this (via broker)
    // so we can forward a reliable stop signal into the session watchdog.
    workerHalted: t.procedure
      .input(z.object({ projectPath: z.string(), agentType: agentTypeSchema }))
      .mutation(async ({ input }) => {
         return WatchdogManager.notifyWorkerHalted(input.projectPath, input.agentType as AgentType);
      })
  })
});

export type AppRouter = typeof appRouter;

// Broker Port
const HTTP_PORT = parseInt(process.env.PORT_BROKER_HTTP || '5000');
const WS_PORT = parseInt(process.env.PORT_BROKER_WS || '5001');
// An explicit interface (e.g. the Tailscale IP from `pnpm dev:host`); unset means loopback only.
const BIND_HOST = process.env.BIND_HOST || undefined;
const host = resolveBindHost(BIND_HOST);
// The broker starts agent sessions: only pages from this machine (or the named
// host) and local programs without an Origin may use it.
const allowedOrigin = (req: http.IncomingMessage) => isAllowedClientOrigin(req.headers.origin, BIND_HOST);

const app = express();
app.use((req, res, next) => (allowedOrigin(req) ? next() : res.status(403).send('Origin not allowed')));
app.use(cors());

// Serve static client
// We are in packages/wrapped-agents/broker/dist (compiled) or src (dev)
// Target: packages/wrapped-agents/client/dist
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
app.use(express.static(CLIENT_DIST));

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }) as any
);

const server = app.listen(HTTP_PORT, host, () => {
  console.log(`[WatchdogBroker] HTTP Server running on http://${host}:${HTTP_PORT}`);
});

console.log(`[WatchdogBroker] WebSocket Server running on ws://${host}:${WS_PORT}`);

// Watch live sessions for self-edit relaunch indicators (idea 29021d9a).
WatchdogManager.startRelaunchWatcher();

// WebSocket Server
const wss = new WebSocketServer({ port: WS_PORT, host, verifyClient: ({ req }: { req: http.IncomingMessage }) => allowedOrigin(req) });
applyWSSHandler({
  wss: wss as any,
  router: appRouter,
  createContext,
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing servers');
  server.close();
  wss.close();
});
