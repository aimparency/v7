import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { continueHookStatus, disableContinueHook, enableContinueHook } from 'shared/continue-hook';
import { readSystemStatus, writeSystemStatus } from '../storage/project.js';
import { graphAddress } from '../graphs/address.js';

const readContinueHook = (projectPath: string) => {
  try {
    return continueHookStatus(projectPath);
  } catch {
    return { installed: false, enabled: false }; // not a git repository
  }
};

export const systemRouter = t.router({
  // The agents' Stop continuation hook, the same switch as the MCP enable-hook / disable-hook prompts.
  getContinueHook: delayedProcedure
    .input(z.object({ graph: graphAddress }))
    .query(({ input }) => readContinueHook(input.graph)),

  setContinueHook: delayedProcedure
    .input(z.object({ graph: graphAddress, enabled: z.boolean() }))
    .mutation(({ input }) => {
      if (input.enabled) enableContinueHook(input.graph);
      else disableContinueHook(input.graph);
      return readContinueHook(input.graph);
    }),

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
