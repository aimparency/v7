import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { getSemanticNeighbours } from '../semantic-neighbours.js';

export const graphRouter = t.router({
  getSemanticNeighbours: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      return await getSemanticNeighbours(input.projectPath);
    })
});
