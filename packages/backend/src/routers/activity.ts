import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { IDEA_ACCESS_KINDS, type IdeaAccessKind, type IdeaActivityEvent } from 'shared';
import { t, procedure, delayedProcedure } from '../trpc.js';
import { ideaActivitySnapshot, onIdeaAccess, recordIdeaAccess } from '../idea-activity.js';
import { normalizeProjectPath } from '../project-path.js';

const accessKind = z.enum(Object.keys(IDEA_ACCESS_KINDS) as [IdeaAccessKind, ...IdeaAccessKind[]]);

export const activityRouter = t.router({
  // The MCP server reports which ideas its read tools showed an agent.
  record: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      ideaIds: z.array(z.string().uuid()).max(5000),
      kind: accessKind
    }))
    .mutation(({ input }) => {
      recordIdeaAccess(input.projectPath, input.ideaIds, input.kind);
    }),

  snapshot: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(({ input }) => ideaActivitySnapshot(input.projectPath)),

  onAccess: procedure
    .input(z.object({ projectPath: z.string() }))
    .subscription(({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      return observable<IdeaActivityEvent>((emit) =>
        onIdeaAccess((event) => { if (event.projectPath === projectPath) emit.next(event); }));
    })
});
