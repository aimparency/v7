import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import { currentPhaseCursors, type Phase } from 'shared';
import { assertWritableBowman } from 'shared/bowman-migration';
import { t, delayedProcedure } from '../trpc.js';
import { emitChange } from '../change-events.js';
import { readPhase, listPhases, writePhase, updatePhase } from '../storage/phases.js';
import { readProjectMeta, updateProjectMeta } from '../storage/project.js';
import { normalizeProjectPath } from '../project-path.js';
import { cleanupCommitments } from '../storage/commitments.js';
import { addPhaseToIndex, updatePhaseInIndex, removePhaseFromIndex, searchPhases } from '../search.js';
import { ensureSearchIndex } from '../search-index.js';

// Updates the ordered list a phase lives in: its parent's childPhaseIds, or
// meta.rootPhaseIds for root phases. Locked, so concurrent edits don't drop ids.
const updateSiblingIds = (projectPath: string, parentId: string | null, update: (siblingIds: string[]) => string[]) =>
  parentId
    ? updatePhase(projectPath, parentId, (parent) => ({ ...parent, childPhaseIds: update(parent.childPhaseIds ?? []) }))
    : updateProjectMeta(projectPath, (meta) => ({ ...meta, rootPhaseIds: update(meta.rootPhaseIds ?? []) }));

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
      await updateSiblingIds(input.projectPath, phase.parent, (siblingIds) => {
        // A fresh meta derives its root list from the phase files, which already include this one.
        const updated = siblingIds.filter((id) => id !== phaseId);
        updated.splice(input.phase.order ?? updated.length, 0, phaseId);
        return updated;
      });
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
      const oldParentId = (await readPhase(input.projectPath, input.phaseId)).parent ?? null;
      const newParentId = input.phase.parent;

      if (newParentId !== undefined && newParentId !== oldParentId) {
        await updateSiblingIds(input.projectPath, oldParentId, (siblingIds) => siblingIds.filter((id) => id !== input.phaseId));
        await updateSiblingIds(input.projectPath, newParentId, (siblingIds) => {
          const updated = siblingIds.filter((id) => id !== input.phaseId);
          updated.splice(Math.min(input.insertionIndex ?? updated.length, updated.length), 0, input.phaseId);
          return updated;
        });
      }

      // Only the given fields change, applied to the current file, so a
      // concurrent commitment isn't overwritten with a stale list.
      const updatedPhase = (await updatePhase(input.projectPath, input.phaseId, (existingPhase) => ({
        ...existingPhase,
        ...(input.phase.name !== undefined ? { name: input.phase.name } : {}),
        ...(input.phase.from !== undefined ? { from: input.phase.from } : {}),
        ...(input.phase.to !== undefined ? { to: input.phase.to } : {}),
        ...(newParentId !== undefined ? { parent: newParentId } : {}),
        ...(input.phase.commitments !== undefined ? { commitments: input.phase.commitments } : {})
      })))!;
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
      await updateSiblingIds(input.projectPath, phase.parent ?? null, (siblingIds) => {
        const currentIndex = siblingIds.indexOf(input.phaseId);
        if (currentIndex === -1) {
          throw new Error(`Phase ${input.phaseId} not found in sibling list`);
        }
        const updated = siblingIds.filter((id) => id !== input.phaseId);
        updated.splice(Math.min(input.newIndex, updated.length), 0, input.phaseId);
        return updated;
      });
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
        await updatePhase(input.projectPath, childId, (child) => ({ ...child, parent: phase.parent ?? null })).catch(() => null);
      }
      await updateSiblingIds(input.projectPath, phase.parent ?? null, spliceChildren);
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
      await updateProjectMeta(input.projectPath, (meta) => ({ ...meta, phaseCursors: input.cursors, phaseActiveLevel: input.activeLevel }));
      return { success: true };
    }),

  getActivePath: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      const meta = await readProjectMeta(input.projectPath);
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
