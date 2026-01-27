import { z } from 'zod';

export const createGraphRouter = (
  t: any,
  delayedProcedure: any,
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
