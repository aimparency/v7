import { z } from 'zod';
import { hasAccounts } from 'shared/server-config';
import { localMcpCommand } from '../local-mcp.js';
import { t, delayedProcedure } from '../trpc.js';
import { readSystemStatus, writeSystemStatus } from '../storage/project.js';
import { spaceAddress } from '../spaces/address.js';

export const systemRouter = t.router({
  mcpCommand: delayedProcedure.query(() => hasAccounts() ? null : localMcpCommand()),

  getStatus: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .query(async ({ input }) => {
      return await readSystemStatus(input.space);
    }),

  updateStatus: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      status: z.object({
        computeCredits: z.number().optional(),
        funds: z.number().optional()
      })
    }))
    .mutation(async ({ input }) => {
      const current = await readSystemStatus(input.space);
      const updated = {
          ...current,
          ...(input.status.computeCredits !== undefined ? { computeCredits: input.status.computeCredits } : {}),
          ...(input.status.funds !== undefined ? { funds: input.status.funds } : {})
      };
      await writeSystemStatus(input.space, updated);
      return updated;
    }),

  performWork: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      workType: z.enum(['mining', 'freelance']).optional()
    }))
    .mutation(async ({ input }) => {
      const current = await readSystemStatus(input.space);

      // Simulate work logic
      const earnedCredits = Math.floor(Math.random() * 5) + 5; // 5-10 credits
      const earnedFunds = Math.floor(Math.random() * 10) + 1; // 1-10 funds

      const updated = {
        computeCredits: current.computeCredits + earnedCredits,
        funds: current.funds + earnedFunds
      };

      await writeSystemStatus(input.space, updated);

      return {
        ...updated,
        earned: {
          credits: earnedCredits,
          funds: earnedFunds
        }
      };
    })
});
