import { z } from 'zod';
import type { ProcedureBuilder } from '@trpc/server';

export const createGraphRouter = (
  t: any,
  delayedProcedure: ProcedureBuilder<any, any>,
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
