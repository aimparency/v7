import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import type { ProcedureBuilder } from '@trpc/server';
import type { Phase } from 'shared';

export const createPhaseRouter = (
  t: any,
  delayedProcedure: ProcedureBuilder<any, any>,
  readPhase: (projectPath: string, phaseId: string) => Promise<Phase>,
  listPhases: (projectPath: string, parentPhaseId?: string | null) => Promise<Phase[]>,
  writePhase: (projectPath: string, phase: Phase) => Promise<void>,
  calculateSmartSubPhaseDates: (projectPath: string, parentId: string) => Promise<{ from: number, to: number }>,
  normalizeProjectPath: (p: string) => string,
  cleanupCommitments: (projectPath: string, specificPhaseId?: string) => Promise<number>,
  addPhaseToIndex: (projectPath: string, phase: Phase) => void,
  updatePhaseInIndex: (projectPath: string, phase: Phase) => void,
  removePhaseFromIndex: (projectPath: string, phaseId: string) => void,
  searchPhases: (projectPath: string, query: string, phases: Phase[]) => Promise<Phase[]>,
  ensureSearchIndex: (projectPath: string) => Promise<void>,
  ee: any
) => {
  return t.router({
    create: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phase: z.object({
          name: z.string(),
          from: z.number().optional(),
          to: z.number().optional(),
          parent: z.string().nullable().optional(),
          commitments: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        let from = input.phase.from;
        let to = input.phase.to;

        // Smart Dates Logic
        if (from === undefined || to === undefined) {
            if (input.phase.parent) {
                const smartDates = await calculateSmartSubPhaseDates(input.projectPath, input.phase.parent);
                if (from === undefined) from = smartDates.from;
                if (to === undefined) to = smartDates.to;
            } else {
                if (from === undefined || to === undefined) {
                     throw new Error("Start and End dates are required for root phases (no parent specified).");
                }
            }
        }

        const phaseId = uuidv4();
        const phase: Phase = {
          id: phaseId,
          name: input.phase.name,
          from: from!,
          to: to!,
          parent: input.phase.parent ?? null,
          commitments: input.phase.commitments || []
        };

        await writePhase(input.projectPath, phase);
        addPhaseToIndex(input.projectPath, phase);
        return { id: phaseId };
      }),

    get: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        return await readPhase(input.projectPath, input.phaseId);
      }),

    list: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentPhaseId: z.string().uuid().nullable().optional(),
        activeAt: z.number().optional(),
        all: z.boolean().optional()
      }))
      .query(async ({ input }: any) => {
        let phases = await listPhases(input.projectPath, input.parentPhaseId);

        if (input.all) {
            return phases;
        }

        const time = input.activeAt ?? Date.now();
        return phases.filter((p: Phase) => p.from <= time && p.to >= time);
      }),

    update: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid(),
        phase: z.object({
          name: z.string().optional(),
          from: z.number().optional(),
          to: z.number().optional(),
          parent: z.string().nullable().optional(),
          commitments: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const existingPhase = await readPhase(input.projectPath, input.phaseId);

        // Manual merge to satisfy type checker
        const updatedPhase: Phase = {
            ...existingPhase,
            ...(input.phase.name !== undefined ? { name: input.phase.name } : {}),
            ...(input.phase.from !== undefined ? { from: input.phase.from } : {}),
            ...(input.phase.to !== undefined ? { to: input.phase.to } : {}),
            ...(input.phase.parent !== undefined ? { parent: input.phase.parent } : {}),
            ...(input.phase.commitments !== undefined ? { commitments: input.phase.commitments } : {})
        };

        await writePhase(input.projectPath, updatedPhase);
        updatePhaseInIndex(input.projectPath, updatedPhase);
        return updatedPhase;
      }),

    delete: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phaseId: z.string().uuid()
      }))
      .mutation(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        const phasePath = path.join(projectPath, 'phases', `${input.phaseId}.json`);
        await fs.remove(phasePath);

        await cleanupCommitments(input.projectPath, input.phaseId);

        removePhaseFromIndex(input.projectPath, input.phaseId);
        ee.emit('change', { type: 'phase', id: input.phaseId, projectPath: input.projectPath });
        return { success: true };
      }),

    search: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        query: z.string(),
        parentPhaseId: z.string().uuid().nullable().optional()
      }))
      .query(async ({ input }: any) => {
        await ensureSearchIndex(input.projectPath);
        const phases = await listPhases(input.projectPath, input.parentPhaseId);
        return await searchPhases(input.projectPath, input.query, phases);
      }),

    suggestSubPhaseConfig: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        parentPhaseId: z.string().uuid()
      }))
      .query(async ({ input }: any) => {
        return await calculateSmartSubPhaseDates(input.projectPath, input.parentPhaseId);
      })
  });
};
