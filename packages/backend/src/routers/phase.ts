import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import type { Phase } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

export const createPhaseRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  readPhase: (projectPath: string, phaseId: string) => Promise<Phase>,
  listPhases: (projectPath: string, parentPhaseId?: string | null) => Promise<Phase[]>,
  writePhase: (projectPath: string, phase: Phase) => Promise<void>,
  normalizeProjectPath: (p: string) => string,
  cleanupCommitments: (projectPath: string, specificPhaseId?: string) => Promise<number>,
  addPhaseToIndex: (projectPath: string, phase: Phase) => void,
  updatePhaseInIndex: (projectPath: string, phase: Phase) => void,
  removePhaseFromIndex: (projectPath: string, phaseId: string) => void,
  searchPhases: (projectPath: string, query: string, phases: Phase[]) => Promise<Phase[]>,
  ensureSearchIndex: (projectPath: string) => Promise<void>,
  ee: any
) => {
  const readMeta = async (rawProjectPath: string) => {
    const projectPath = normalizeProjectPath(rawProjectPath);
    await fs.ensureDir(projectPath);
    const metaPath = path.join(projectPath, 'meta.json');
    if (!(await fs.pathExists(metaPath))) {
      return {
        name: path.basename(path.dirname(projectPath)) || 'Project',
        color: '#007acc',
        statuses: [],
        phaseCursors: {},
        phaseActiveLevel: 0,
        rootPhaseIds: []
      };
    }

    const meta = await fs.readJson(metaPath);
    if (!meta.phaseCursors) meta.phaseCursors = {};
    if (meta.phaseActiveLevel === undefined) meta.phaseActiveLevel = 0;
    if (!meta.rootPhaseIds) meta.rootPhaseIds = [];
    return meta;
  };

  const writeMeta = async (rawProjectPath: string, meta: any) => {
    const projectPath = normalizeProjectPath(rawProjectPath);
    await fs.ensureDir(projectPath);
    const metaPath = path.join(projectPath, 'meta.json');
    await fs.writeJson(metaPath, meta, { spaces: 2 });
  };

  return t.router({
    create: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        phase: z.object({
          name: z.string(),
          from: z.number().optional(),
          to: z.number().optional(),
          order: z.number().int().nonnegative().optional(),
          parent: z.string().nullable().optional(),
          commitments: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        let from = input.phase.from;
        let to = input.phase.to;

        if (from === undefined) {
          from = 0;
        }
        if (to === undefined) {
          to = from;
        }

        const siblingPhases = await listPhases(input.projectPath, input.phase.parent ?? null);
        const targetOrder = input.phase.order ?? siblingPhases.length;

        const phaseId = uuidv4();
        const phase: Phase = {
          id: phaseId,
          name: input.phase.name,
          from: from!,
          to: to!,
          order: undefined,
          parent: input.phase.parent ?? null,
          childPhaseIds: [],
          commitments: input.phase.commitments || []
        };

        await writePhase(input.projectPath, phase);
        if (phase.parent) {
          const parent = await readPhase(input.projectPath, phase.parent);
          const childPhaseIds = [...(parent.childPhaseIds ?? [])];
          childPhaseIds.splice(targetOrder, 0, phaseId);
          await writePhase(input.projectPath, { ...parent, childPhaseIds });
        } else {
          const meta = await readMeta(input.projectPath);
          const rootPhaseIds = [...(meta.rootPhaseIds ?? [])];
          rootPhaseIds.splice(targetOrder, 0, phaseId);
          meta.rootPhaseIds = rootPhaseIds;
          await writeMeta(input.projectPath, meta);
        }
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
          order: z.number().int().nonnegative().optional(),
          parent: z.string().nullable().optional(),
          commitments: z.array(z.string()).optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        const existingPhase = await readPhase(input.projectPath, input.phaseId);
        const oldParentId = existingPhase.parent ?? null;

        // Manual merge to satisfy type checker
        const updatedPhase: Phase = {
            ...existingPhase,
            ...(input.phase.name !== undefined ? { name: input.phase.name } : {}),
            ...(input.phase.from !== undefined ? { from: input.phase.from } : {}),
            ...(input.phase.to !== undefined ? { to: input.phase.to } : {}),
            ...(input.phase.parent !== undefined ? { parent: input.phase.parent } : {}),
            ...(input.phase.childPhaseIds !== undefined ? { childPhaseIds: input.phase.childPhaseIds } : {}),
            ...(input.phase.commitments !== undefined ? { commitments: input.phase.commitments } : {})
        };

        if (input.phase.parent !== undefined && input.phase.parent !== oldParentId) {
          if (oldParentId) {
            const oldParent = await readPhase(input.projectPath, oldParentId);
            await writePhase(input.projectPath, {
              ...oldParent,
              childPhaseIds: (oldParent.childPhaseIds ?? []).filter((id) => id !== input.phaseId)
            });
          } else {
            const meta = await readMeta(input.projectPath);
            meta.rootPhaseIds = (meta.rootPhaseIds ?? []).filter((id: string) => id !== input.phaseId);
            await writeMeta(input.projectPath, meta);
          }

          if (updatedPhase.parent) {
            const newParent = await readPhase(input.projectPath, updatedPhase.parent);
            await writePhase(input.projectPath, {
              ...newParent,
              childPhaseIds: [...(newParent.childPhaseIds ?? []), input.phaseId]
            });
          } else {
            const meta = await readMeta(input.projectPath);
            meta.rootPhaseIds = [...(meta.rootPhaseIds ?? []), input.phaseId];
            await writeMeta(input.projectPath, meta);
          }
        }

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
        const phase = await readPhase(input.projectPath, input.phaseId);
        if (phase.parent) {
          const parent = await readPhase(input.projectPath, phase.parent);
          await writePhase(input.projectPath, {
            ...parent,
            childPhaseIds: (parent.childPhaseIds ?? []).filter((id) => id !== input.phaseId)
          });
        } else {
          const meta = await readMeta(input.projectPath);
          meta.rootPhaseIds = (meta.rootPhaseIds ?? []).filter((id: string) => id !== input.phaseId);
          await writeMeta(input.projectPath, meta);
        }
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
    })
  });
};
