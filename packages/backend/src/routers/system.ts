import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { continueHookStatus, disableContinueHook, enableContinueHook } from 'shared/continue-hook';
import { readSystemStatus, writeSystemStatus } from '../storage/project.js';

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
    .input(z.object({ projectPath: z.string() }))
    .query(({ input }) => readContinueHook(input.projectPath)),

  setContinueHook: delayedProcedure
    .input(z.object({ projectPath: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      if (input.enabled) enableContinueHook(input.projectPath);
      else disableContinueHook(input.projectPath);
      return readContinueHook(input.projectPath);
    }),

  getStatus: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      return await readSystemStatus(input.projectPath);
    }),

  updateStatus: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      status: z.object({
        computeCredits: z.number().optional(),
        funds: z.number().optional()
      })
    }))
    .mutation(async ({ input }) => {
      const current = await readSystemStatus(input.projectPath);
      const updated = {
          ...current,
          ...(input.status.computeCredits !== undefined ? { computeCredits: input.status.computeCredits } : {}),
          ...(input.status.funds !== undefined ? { funds: input.status.funds } : {})
      };
      await writeSystemStatus(input.projectPath, updated);
      return updated;
    }),

  performWork: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      workType: z.enum(['mining', 'freelance']).optional()
    }))
    .mutation(async ({ input }) => {
      const current = await readSystemStatus(input.projectPath);

      // Simulate work logic
      const earnedCredits = Math.floor(Math.random() * 5) + 5; // 5-10 credits
      const earnedFunds = Math.floor(Math.random() * 10) + 1; // 1-10 funds

      const updated = {
        computeCredits: current.computeCredits + earnedCredits,
        funds: current.funds + earnedFunds
      };

      await writeSystemStatus(input.projectPath, updated);

      return {
        ...updated,
        earned: {
          credits: earnedCredits,
          funds: earnedFunds
        }
      };
    })
});
