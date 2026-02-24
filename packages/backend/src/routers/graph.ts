import { z } from 'zod';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

export const createGraphRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  getSemanticGraph: (projectPath: string) => Promise<any>
) => {
  return t.router({
    getSemanticForces: delayedProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }: any) => {
        return await getSemanticGraph(input.projectPath);
      })
  });
};
