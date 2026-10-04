import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import { currentPhaseCursors, type Phase } from 'shared';
import { assertWritableBowman } from 'shared/bowman-migration';
import { t, delayedProcedure } from '../trpc.js';
import { emitChange } from '../change-events.js';
import { readPhase, listPhases, writePhase } from '../storage/phases.js';
import { readProjectMeta, writeProjectMeta } from '../storage/project.js';
import { normalizeProjectPath } from '../project-path.js';
import { cleanupCommitments } from '../storage/commitments.js';
import { addPhaseToIndex, updatePhaseInIndex, removePhaseFromIndex, searchPhases } from '../search.js';
import { ensureSearchIndex } from '../search-index.js';

const readMeta = readProjectMeta;
const writeMeta = writeProjectMeta;

const phaseAncestorNames = (phase: Phase, phasesById: Map<string, Phase>) => {
  const names: string[] = [];
  const visited = new Set<string>([phase.id]);
  let parentId = phase.parent;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = phasesById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parent;
  }
  return names;
};

export const phaseRouter = t.router({
  create: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      phase: z.object({
        name: z.string(),
        order: z.number().int().nonnegative().optional(),
        from: z.number().optional(),
        to: z.number().optional(),
        parent: z.string().nullable().optional(),
        commitments: z.array(z.string()).optional()
      })
    }))
    .mutation(async ({ input }) => {
      const parentOwner = input.phase.parent
        ? await readPhase(input.projectPath, input.phase.parent)
        : null;
      const rootOwner = input.phase.parent
        ? null
        : await readMeta(input.projectPath);
      let targetOrder = input.phase.order;
      if (targetOrder === undefined) {
        targetOrder = input.phase.parent
          ? (parentOwner?.childPhaseIds ?? []).length
          : (rootOwner?.rootPhaseIds ?? []).length;
      }

      const phaseId = uuidv4();
      const phase: Phase = {
        id: phaseId,
        name: input.phase.name,
        ...(input.phase.from !== undefined ? { from: input.phase.from } : {}),
        ...(input.phase.to !== undefined ? { to: input.phase.to } : {}),
        parent: input.phase.parent ?? null,
        childPhaseIds: [],
        commitments: input.phase.commitments || []
      };

      await writePhase(input.projectPath, phase);
      if (phase.parent && parentOwner) {
        const childPhaseIds = [...(parentOwner.childPhaseIds ?? [])];
        childPhaseIds.splice(targetOrder, 0, phaseId);
        await writePhase(input.projectPath, { ...parentOwner, childPhaseIds });
      } else if (rootOwner) {
        const rootPhaseIds = [...(rootOwner.rootPhaseIds ?? [])];
        rootPhaseIds.splice(targetOrder, 0, phaseId);
        rootOwner.rootPhaseIds = rootPhaseIds;
        await writeMeta(input.projectPath, rootOwner);
      }
      addPhaseToIndex(input.projectPath, phase);
      return { id: phaseId };
    }),

  get: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      phaseId: z.string().uuid()
    }))
    .query(async ({ input }) => {
      return await readPhase(input.projectPath, input.phaseId);
    }),

  list: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      parentPhaseId: z.string().uuid().nullable().optional()
    }))
    .query(async ({ input }) => {
      return await listPhases(input.projectPath, input.parentPhaseId);
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
      }),
      // Position among the new parent's children when `parent` changes;
      // appends when omitted. Lets a move be one mutation instead of
      // update + reorder, so clients never see the phase at a stand-in slot.
      insertionIndex: z.number().int().nonnegative().optional()
    }))
    .mutation(async ({ input }) => {
      const existingPhase = await readPhase(input.projectPath, input.phaseId);
      const insertAt = (siblingIds: string[]) => {
        const index = Math.min(input.insertionIndex ?? siblingIds.length, siblingIds.length);
        return [...siblingIds.slice(0, index), input.phaseId, ...siblingIds.slice(index)];
      };
      const oldParentId = existingPhase.parent ?? null;

      const updatedPhase: Phase = {
          ...existingPhase,
          ...(input.phase.name !== undefined ? { name: input.phase.name } : {}),
          ...(input.phase.from !== undefined ? { from: input.phase.from } : {}),
          ...(input.phase.to !== undefined ? { to: input.phase.to } : {}),
          ...(input.phase.parent !== undefined ? { parent: input.phase.parent } : {}),
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
            childPhaseIds: insertAt(newParent.childPhaseIds ?? [])
          });
        } else {
          const meta = await readMeta(input.projectPath);
          meta.rootPhaseIds = insertAt(meta.rootPhaseIds ?? []);
          await writeMeta(input.projectPath, meta);
        }
      }

      await writePhase(input.projectPath, updatedPhase);
      updatePhaseInIndex(input.projectPath, updatedPhase);
      return updatedPhase;
    }),

  reorder: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      phaseId: z.string().uuid(),
      newIndex: z.number().int().nonnegative()
    }))
    .mutation(async ({ input }) => {
      const phase = await readPhase(input.projectPath, input.phaseId);
      const parentId = phase.parent ?? null;
      const siblingIds = parentId
        ? [...((await readPhase(input.projectPath, parentId)).childPhaseIds ?? [])]
        : [...((await readMeta(input.projectPath)).rootPhaseIds ?? [])];
      const currentIndex = siblingIds.indexOf(input.phaseId);

      if (currentIndex === -1) {
        throw new Error(`Phase ${input.phaseId} not found in sibling list`);
      }

      siblingIds.splice(currentIndex, 1);
      const targetIndex = Math.min(input.newIndex, siblingIds.length);
      siblingIds.splice(targetIndex, 0, input.phaseId);

      if (parentId) {
        const parent = await readPhase(input.projectPath, parentId);
        await writePhase(input.projectPath, { ...parent, childPhaseIds: siblingIds });
      } else {
        const meta = await readMeta(input.projectPath);
        meta.rootPhaseIds = siblingIds;
        await writeMeta(input.projectPath, meta);
      }
      return { success: true };
    }),

  delete: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      phaseId: z.string().uuid()
    }))
    .mutation(async ({ input }) => {
      const projectPath = normalizeProjectPath(input.projectPath);
      const phase = await readPhase(input.projectPath, input.phaseId);
      // Child phases take the deleted phase's slot in its parent, in order, so
      // the column keeps its shape instead of the children jumping to the end.
      const childPhaseIds = phase.childPhaseIds ?? [];
      const spliceChildren = (siblingIds: string[]) => {
        const index = siblingIds.indexOf(input.phaseId);
        const withoutPhase = siblingIds.filter((id) => id !== input.phaseId && !childPhaseIds.includes(id));
        withoutPhase.splice(index === -1 ? withoutPhase.length : index, 0, ...childPhaseIds);
        return withoutPhase;
      };
      for (const childId of childPhaseIds) {
        const child = await readPhase(input.projectPath, childId).catch(() => null);
        if (child) await writePhase(input.projectPath, { ...child, parent: phase.parent ?? null });
      }
      if (phase.parent) {
        const parent = await readPhase(input.projectPath, phase.parent);
        await writePhase(input.projectPath, {
          ...parent,
          childPhaseIds: spliceChildren(parent.childPhaseIds ?? [])
        });
      } else {
        const meta = await readMeta(input.projectPath);
        meta.rootPhaseIds = spliceChildren(meta.rootPhaseIds ?? []);
        await writeMeta(input.projectPath, meta);
      }
      const phasePath = path.join(projectPath, 'phases', `${input.phaseId}.json`);
      const previous = await fs.readJson(phasePath).catch(() => null);
      await assertWritableBowman(projectPath);
      await fs.remove(phasePath);

      await cleanupCommitments(input.projectPath, input.phaseId);

      removePhaseFromIndex(input.projectPath, input.phaseId);
      emitChange({ type: 'phase', id: input.phaseId, projectPath: input.projectPath, deleted: true, previous });
      return { success: true };
    }),

  search: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      query: z.string(),
      parentPhaseId: z.string().uuid().nullable().optional()
    }))
    .query(async ({ input }) => {
      await ensureSearchIndex(input.projectPath);
      const allPhases = await listPhases(input.projectPath);
      const phases = input.parentPhaseId === undefined
        ? allPhases
        : allPhases.filter((phase) => phase.parent === input.parentPhaseId);
      const results = await searchPhases(input.projectPath, input.query, phases);
      const phasesById = new Map(allPhases.map((phase) => [phase.id, phase]));
      return results.map((phase) => ({
        ...phase,
        ancestorNames: phaseAncestorNames(phase, phasesById)
      }));
  }),

  setCursor: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      cursors: z.record(z.string(), z.string()),
      activeLevel: z.number().int().min(0)
    }))
    .mutation(async ({ input }) => {
      const meta = await readMeta(input.projectPath);
      meta.phaseCursors = input.cursors;
      meta.phaseActiveLevel = input.activeLevel;
      await writeMeta(input.projectPath, meta);
      return { success: true };
    }),

  getActivePath: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      const meta = await readMeta(input.projectPath);
      const cursors = currentPhaseCursors(meta);
      const activeLevel: number = meta.phaseActiveLevel ?? 0;

      const levels = Object.keys(cursors)
        .map(Number)
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

      const path: Phase[] = [];
      for (const level of levels) {
        const phaseId = cursors[String(level)];
        if (!phaseId) break;
        try {
          const phase = await readPhase(input.projectPath, phaseId);
          path.push(phase);
        } catch {
          break;
        }
      }

      return {
        path,
        activeLevel,
        activePhase: path[path.length - 1] ?? null
      };
    })
});
