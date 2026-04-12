import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { AimSchema, PhaseSchema, ProjectMetaSchema } from './types.js';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  aim: router({
    create: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        aim: AimSchema.omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    get: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    list: publicProcedure
      .input(z.object({
        projectPath: z.string()
      }))
      .query(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    update: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        aim: AimSchema.partial().omit({ id: true })
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    delete: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    commitToPhase: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
        phaseId: z.string().uuid(),
        insertionIndex: z.number().optional()
      }))
      .mutation(async ({ input }) => {
        throw new Error('Not implemented');
      }),

    removeFromPhase: publicProcedure
      .input(z.object({
        projectPath: z.string(),
        aimId: z.string().uuid(),
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
