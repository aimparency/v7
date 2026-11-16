import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { getSemanticNeighbours } from '../semantic-neighbours.js';
import { graphAddress } from '../graphs/address.js';
import { idsBeginningWith } from '../storage/id-prefixes.js';

export const graphRouter = t.router({
  getSemanticNeighbours: delayedProcedure
    .input(z.object({
      graph: graphAddress
    }))
    .query(async ({ input }) => {
      return await getSemanticNeighbours(input.graph);
    }),

  // The full ids of ideas and phases from their beginnings: for each prefix,
  // every id that begins with it (none, one, or several to choose from).
  idsBeginningWith: delayedProcedure
    .input(z.object({
      graph: graphAddress,
      prefixes: z.array(z.string().regex(/^[0-9a-fA-F-]{4,36}$/)).max(100)
    }))
    .query(async ({ input }) => idsBeginningWith(input.graph, input.prefixes))
});
