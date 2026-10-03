import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { getSemanticGraph } from '../forces.js';

export const graphRouter = t.router({
  getSemanticForces: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      return await getSemanticGraph(input.projectPath);
    })
});
