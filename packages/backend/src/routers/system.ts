import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hasAccounts } from 'shared/server-config';
import { t, delayedProcedure } from '../trpc.js';
import { readSystemStatus, writeSystemStatus } from '../storage/project.js';
import { graphAddress } from '../graphs/address.js';

// Without accounts an agent starts the MCP server itself, over stdio: the
// command with this checkout's absolute paths works from any directory. The
// server reaches this backend over its WebSocket, named only when not the default.
export function localMcpCommand() {
  const mcp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../mcp');
  const host = process.env.BIND_HOST;
  const port = process.env.PORT_BACKEND_WS;
  const env: Record<string, string> = host || (port && port !== '3001') ? { BACKEND_WS_URL: `ws://${host || 'localhost'}:${port || '3001'}` } : {};
  return { command: path.join(mcp, 'node_modules/.bin/tsx'), args: [path.join(mcp, 'src/index.ts')], env };
}

export const systemRouter = t.router({
  mcpCommand: delayedProcedure.query(() => hasAccounts() ? null : localMcpCommand()),

  getStatus: delayedProcedure
    .input(z.object({
      graph: graphAddress
    }))
    .query(async ({ input }) => {
      return await readSystemStatus(input.graph);
    }),

  updateStatus: delayedProcedure
    .input(z.object({
      graph: graphAddress,
      status: z.object({
        computeCredits: z.number().optional(),
        funds: z.number().optional()
      })
    }))
    .mutation(async ({ input }) => {
      const current = await readSystemStatus(input.graph);
      const updated = {
          ...current,
          ...(input.status.computeCredits !== undefined ? { computeCredits: input.status.computeCredits } : {}),
          ...(input.status.funds !== undefined ? { funds: input.status.funds } : {})
      };
      await writeSystemStatus(input.graph, updated);
      return updated;
    }),

  performWork: delayedProcedure
    .input(z.object({
      graph: graphAddress,
      workType: z.enum(['mining', 'freelance']).optional()
    }))
    .mutation(async ({ input }) => {
      const current = await readSystemStatus(input.graph);

      // Simulate work logic
      const earnedCredits = Math.floor(Math.random() * 5) + 5; // 5-10 credits
      const earnedFunds = Math.floor(Math.random() * 10) + 1; // 1-10 funds

      const updated = {
        computeCredits: current.computeCredits + earnedCredits,
        funds: current.funds + earnedFunds
      };

      await writeSystemStatus(input.graph, updated);

      return {
        ...updated,
        earned: {
          credits: earnedCredits,
          funds: earnedFunds
        }
      };
    })
});
