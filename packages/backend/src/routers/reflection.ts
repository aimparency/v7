import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import {
  saveReflection,
  getReflections,
  getLatestReflection,
  getAllReflections,
  extractPatterns,
  formatReflectionsForContext,
  type Reflection
} from '../reflections.js';

const t = initTRPC.create();

export const reflectionRouter = t.router({
  /**
   * Save a reflection for an aim
   */
  save: t.procedure
    .input(z.object({
      projectPath: z.string(),
      aimId: z.string().uuid(),
      context: z.string(),
      outcome: z.string(),
      effectiveness: z.string(),
      lesson: z.string(),
      pattern: z.string(),
      sessionId: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      const reflection = await saveReflection(input.projectPath, input.aimId, {
        context: input.context,
        outcome: input.outcome,
        effectiveness: input.effectiveness,
        lesson: input.lesson,
        pattern: input.pattern,
        sessionId: input.sessionId
      });
      return reflection;
    }),

  /**
   * Get all reflections for an aim
   */
  getForAim: t.procedure
    .input(z.object({
      projectPath: z.string(),
      aimId: z.string().uuid()
    }))
    .query(async ({ input }) => {
      return getReflections(input.projectPath, input.aimId);
    }),

  /**
   * Get the most recent reflection for an aim
   */
  getLatest: t.procedure
    .input(z.object({
      projectPath: z.string(),
      aimId: z.string().uuid()
    }))
    .query(async ({ input }) => {
      return getLatestReflection(input.projectPath, input.aimId);
    }),

  /**
   * Get all reflections across all aims
   */
  getAll: t.procedure
    .input(z.object({
      projectPath: z.string(),
      limit: z.number().optional().default(50)
    }))
    .query(async ({ input }) => {
      const reflections = await getAllReflections(input.projectPath);
      return reflections.slice(0, input.limit);
    }),

  /**
   * Extract patterns from recent reflections
   */
  getPatterns: t.procedure
    .input(z.object({
      projectPath: z.string(),
      limit: z.number().optional().default(20)
    }))
    .query(async ({ input }) => {
      return extractPatterns(input.projectPath, input.limit);
    }),

  /**
   * Get formatted reflections for context injection
   */
  getForContext: t.procedure
    .input(z.object({
      projectPath: z.string(),
      limit: z.number().optional().default(5)
    }))
    .query(async ({ input }) => {
      const reflections = await getAllReflections(input.projectPath);
      return formatReflectionsForContext(reflections.slice(0, input.limit));
    })
});

export type ReflectionRouter = typeof reflectionRouter;
