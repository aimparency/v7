import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { readSystemStatus, writeSystemStatus } from '../storage/project.js';
import { graphAddress } from '../graphs/address.js';

export const systemRouter = t.router({
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
