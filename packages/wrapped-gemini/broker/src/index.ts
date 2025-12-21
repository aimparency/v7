import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { WatchdogManager } from './manager.js';
import cors from 'cors';
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
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         return await WatchdogManager.start(input.projectPath);
      }),
    stop: t.procedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         const success = WatchdogManager.stop(input.projectPath);
         return { success };
      }),
    relaunch: t.procedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         return await WatchdogManager.relaunch(input.projectPath);
      }),
    getStatus: t.procedure
      .input(z.object({ projectPath: z.string() }))
      .query(async ({ input }) => {
         return WatchdogManager.getStatus(input.projectPath);
      }),
    keepalive: t.procedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(async ({ input }) => {
         const success = WatchdogManager.keepalive(input.projectPath);
         return { success };
      }),
    list: t.procedure
      .query(async () => {
         return WatchdogManager.list();
      })
  })
});

export type AppRouter = typeof appRouter;

// Broker Port
const HTTP_PORT = parseInt(process.env.PORT_BROKER_HTTP || '5000');
const WS_PORT = parseInt(process.env.PORT_BROKER_WS || '5001');

const app = express();
app.use(cors());

// Serve static client
// We are in packages/wrapped-gemini/broker/dist (compiled) or src (dev)
// Target: packages/wrapped-gemini/client/dist
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
app.use(express.static(CLIENT_DIST));

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

const server = app.listen(HTTP_PORT, () => {
  console.log(`[WatchdogBroker] HTTP Server running on http://localhost:${HTTP_PORT}`);
});

console.log(`[WatchdogBroker] WebSocket Server running on ws://localhost:${WS_PORT}`);

// WebSocket Server
const wss = new WebSocketServer({ port: WS_PORT });
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

