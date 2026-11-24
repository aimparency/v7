import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { IDEA_ACCESS_KINDS, type IdeaAccessKind, type IdeaActivityEvent } from 'shared';
import { t, procedure, delayedProcedure } from '../trpc.js';
import { ideaActivitySnapshot, onIdeaAccess, recordIdeaAccess } from '../idea-activity.js';
import { normalizeProjectPath } from '../project-path.js';
import { spaceAddress } from '../spaces/address.js';

const accessKind = z.enum(Object.keys(IDEA_ACCESS_KINDS) as [IdeaAccessKind, ...IdeaAccessKind[]]);

export const activityRouter = t.router({
  // The MCP server reports which ideas its read tools showed an agent.
  record: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      ideaIds: z.array(z.string().uuid()).max(5000),
      kind: accessKind
    }))
    .mutation(({ input }) => {
      recordIdeaAccess(input.space, input.ideaIds, input.kind);
    }),

  snapshot: delayedProcedure
    .input(z.object({ space: spaceAddress }))
    .query(({ input }) => ideaActivitySnapshot(input.space)),

  onAccess: procedure
    .input(z.object({ space: spaceAddress }))
    .subscription(({ input }) => {
      const projectPath = normalizeProjectPath(input.space);
      return observable<IdeaActivityEvent>((emit) =>
        onIdeaAccess((event) => { if (event.projectPath === projectPath) emit.next(event); }));
    })
});
