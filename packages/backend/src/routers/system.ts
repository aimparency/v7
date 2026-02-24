import { z } from 'zod';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

export const createSystemRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  readSystemStatus: (projectPath: string) => Promise<any>,
  writeSystemStatus: (projectPath: string, status: any) => Promise<void>
) => {
  return t.router({
    getStatus: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }: any) => {
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
      .mutation(async ({ input }: any) => {
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
      .mutation(async ({ input }: any) => {
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
};
