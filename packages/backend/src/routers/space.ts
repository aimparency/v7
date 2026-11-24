import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { getSemanticNeighbours } from '../semantic-neighbours.js';
import { spaceAddress } from '../spaces/address.js';
import { idsBeginningWith } from '../storage/id-prefixes.js';

export const spaceRouter = t.router({
  getSemanticNeighbours: delayedProcedure
    .input(z.object({
      space: spaceAddress
    }))
    .query(async ({ input }) => {
      return await getSemanticNeighbours(input.space);
    }),

  // The full ids of ideas and phases from their beginnings: for each prefix,
  // every id that begins with it (none, one, or several to choose from).
  idsBeginningWith: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      prefixes: z.array(z.string().regex(/^[0-9a-fA-F-]{4,36}$/)).max(100)
    }))
    .query(async ({ input }) => idsBeginningWith(input.space, input.prefixes))
});
