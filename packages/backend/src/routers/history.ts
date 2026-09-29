import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import { isDeepStrictEqual } from 'node:util';
import type { Aim, Phase, ProjectMeta } from 'shared';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';
import { addAimToIndex, addPhaseToIndex, removeAimFromIndex, removePhaseFromIndex } from '../search.js';
import { embeddingTextForAim, generateEmbedding, removeEmbedding, saveEmbedding } from '../embeddings.js';
import { invalidateSemanticCache } from '../forces.js';

const EntityChangeSchema = z.object({
  type: z.enum(['aim', 'phase', 'project']),
  id: z.string(),
  // Raw file content the entity must still have (null: must not exist)...
  expected: z.any().nullable(),
  // ...and the content to write (null: delete it).
  target: z.any().nullable()
});

type EntityChange = z.infer<typeof EntityChangeSchema>;

/**
 * Undo/redo backend: applies a set of entity snapshots with compare-and-swap.
 * Every entity must still equal `expected`; otherwise nothing is written and the
 * conflicting entities are reported (e.g. another client edited one since).
 */
export const createHistoryRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  normalizeProjectPath: (p: string) => string,
  writeAim: (projectPath: string, aim: Aim) => Promise<void>,
  writePhase: (projectPath: string, phase: Phase) => Promise<void>,
  writeProjectMeta: (projectPath: string, meta: ProjectMeta) => Promise<void>,
  ee: any
) => {
  const entityFiles = (projectPath: string, change: EntityChange) => {
    if (change.type === 'aim') {
      return ['aims', 'archived-aims'].map((dir) => path.join(projectPath, dir, `${change.id}.json`));
    }
    if (change.type === 'phase') return [path.join(projectPath, 'phases', `${change.id}.json`)];
    return [path.join(projectPath, 'meta.json')];
  };

  const readCurrent = async (projectPath: string, change: EntityChange) => {
    for (const file of entityFiles(projectPath, change)) {
      const content = await fs.readJson(file).catch(() => null);
      if (content !== null) return content;
    }
    return null;
  };

  const applyChange = async (projectPath: string, change: EntityChange, current: unknown) => {
    if (change.type === 'project') {
      if (change.target) await writeProjectMeta(projectPath, change.target as ProjectMeta);
      return;
    }

    if (change.target === null) {
      for (const file of entityFiles(projectPath, change)) await fs.remove(file);
      if (change.type === 'aim') {
        removeAimFromIndex(projectPath, change.id);
        if (process.env.NODE_ENV !== 'test') await removeEmbedding(projectPath, change.id);
      } else {
        removePhaseFromIndex(projectPath, change.id);
      }
      ee.emit('change', { type: change.type, id: change.id, projectPath, deleted: true, previous: current });
      return;
    }

    if (change.type === 'aim') {
      const aim = change.target as Aim;
      await writeAim(projectPath, aim);
      removeAimFromIndex(projectPath, aim.id);
      addAimToIndex(projectPath, aim);
      if (process.env.NODE_ENV !== 'test') {
        generateEmbedding(embeddingTextForAim(aim)).then((vector) => {
          if (vector) saveEmbedding(projectPath, aim.id, vector);
        });
      }
    } else {
      const phase = change.target as Phase;
      await writePhase(projectPath, phase);
      removePhaseFromIndex(projectPath, phase.id);
      addPhaseToIndex(projectPath, phase);
    }
  };

  return t.router({
    restore: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        changes: z.array(EntityChangeSchema)
      }))
      .mutation(async ({ input }: any) => {
        const projectPath = normalizeProjectPath(input.projectPath);
        const changes = input.changes as EntityChange[];

        const currents = await Promise.all(changes.map((change) => readCurrent(projectPath, change)));
        const conflicts = changes
          .filter((change, index) => !isDeepStrictEqual(currents[index], change.expected ?? null))
          .map(({ type, id }) => ({ type, id }));
        if (conflicts.length > 0) return { ok: false as const, conflicts };

        for (let index = 0; index < changes.length; index++) {
          await applyChange(projectPath, changes[index]!, currents[index]);
        }
        if (changes.some((change) => change.type === 'aim')) invalidateSemanticCache(projectPath);
        return { ok: true as const, conflicts: [] };
      })
  });
};
