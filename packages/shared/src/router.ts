import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { IdeaSchema, PhaseSchema, ProjectMetaSchema } from './types.js';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  idea: router({
    create: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        idea: IdeaSchema.omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    get: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    list: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        status: z.union([z.string(), z.array(z.string())]).optional(),
        archived: z.boolean().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.string().optional(),
        limit: z.number().optional()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    createFloatingIdea: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        idea: z.object({
          text: z.string(),
          status: z.object({
            state: z.string().optional()
          }).optional()
        })
      }))
      .mutation(async ({ input }) => {
        return { id: 'uuid' };
      }),

    update: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        idea: IdeaSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    delete: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    commitToPhase: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        phaseId: z.string().uuid(),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    removeFromPhase: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        ideaId: z.string().uuid(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      })
  }),

  phase: router({
    create: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        phase: PhaseSchema.omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    get: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    list: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        parentPhaseId: z.string().uuid().nullable().optional()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    update: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        phase: PhaseSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    reorder: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        newIndex: z.number().int().nonnegative()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    delete: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      })
  }),

  project: router({
    getMeta: publicProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    updateMeta: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        meta: ProjectMetaSchema
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    migrateCommittedIn: publicProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      })
  })
});

// Export the router creation tools so backend can use them

export type AppRouter = typeof appRouter;
