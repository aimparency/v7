import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { getSemanticNeighbours } from '../semantic-neighbours.js';
import { graphAddress } from '../graphs/address.js';

export const graphRouter = t.router({
  getSemanticNeighbours: delayedProcedure
    .input(z.object({
      graph: graphAddress
    }))
    .query(async ({ input }) => {
      return await getSemanticNeighbours(input.graph);
    })
});
