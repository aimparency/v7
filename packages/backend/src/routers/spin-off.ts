import { z } from 'zod';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { planSpinOff, computeSpinOff, remapSpinOffCollisions } from 'shared';
import { t, delayedProcedure } from '../trpc.js';
import { normalizeProjectPath } from '../project-path.js';
import { bowmanExists, completeDirectoryPath, resolveBowmanPath } from '../path-completion.js';
import { addIdeaToIndex, updateIdeaInIndex } from '../search.js';
import { invalidateSemanticCache } from '../forces.js';
import { deleteIdeaCompletely, listIdeas, writeIdea } from '../storage/ideas.js';
import { ensureProjectStructure, readProjectMeta, writeProjectMeta } from '../storage/project.js';
import { cleanupCommitments } from '../storage/commitments.js';

export const spinOffRouter = t.router({
  // Tab-completion for the target path chooser: given a partial path (supporting
  // `~/` and absolute `/`), return matching child directory names and whether the
  // resolved path already holds a .bowman graph (so the UI can warn).
  completePath: delayedProcedure
    .input(z.object({ partial: z.string() }))
    .query(async ({ input }) => {
      return {
        matches: await completeDirectoryPath(input.partial),
        bowmanExists: await bowmanExists(input.partial),
      };
    }),

  // Dry-run: classify ideas into kept (green) / overlap (orange) / spun-off (red)
  // for the graph preview, plus a warning if the target already has a graph.
  preview: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      rootIds: z.array(z.string().uuid()).min(1),
      targetPath: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const ideas = await listIdeas(normalizeProjectPath(input.projectPath));
      const plan = planSpinOff(ideas, input.rootIds);
      return {
        ...plan,
        counts: {
          kept: plan.keptIds.length,
          overlap: plan.overlapIds.length,
          spinOff: plan.spinOffIds.length,
        },
        targetHasBowman: input.targetPath ? await bowmanExists(input.targetPath) : false,
      };
    }),

  // Execute: write the branch (roots + supporters) into a fresh .bowman at
  // targetPath, then optionally prune the source — deleting only ideas that serve
  // the selection exclusively, keeping shared ideas (overlap). Conservative.
  execute: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      rootIds: z.array(z.string().uuid()).min(1),
      targetPath: z.string(),
      removeFromSource: z.boolean().default(true),
      preserveInflow: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const source = normalizeProjectPath(input.projectPath);
      const target = resolveBowmanPath(input.targetPath);
      if (path.resolve(source) === path.resolve(target)) {
        throw new Error('The spin-off target must be a different .bowman graph from the source.');
      }
      const integrateIntoExisting = await bowmanExists(target);

      const ideas = await listIdeas(source);
      const { plan, spinOffIdeas, sourceIdeasToRewrite, sourceIdeaIdsToDelete } =
        computeSpinOff(ideas, input.rootIds, { preserveInflow: input.preserveInflow });

      // For an existing graph, retain all target metadata and remap only ids that
      // collide. Internal branch edges follow the remap; no edge is added to an
      // existing target idea, leaving the imported root(s) free for re-parenting.
      let ideasToWrite = spinOffIdeas;
      let remappedIds: Record<string, string> = {};
      if (integrateIntoExisting) {
        const targetIdeas = [
          ...await listIdeas(target),
          ...await listIdeas(target, true),
        ];
        const remapped = remapSpinOffCollisions(
          spinOffIdeas,
          targetIdeas.map((idea) => idea.id),
          uuidv4,
        );
        ideasToWrite = remapped.ideas;
        remappedIds = remapped.idMap;
      }

      // Write the branch. A fresh graph inherits source presentation metadata;
      // an existing graph remains authoritative for its own settings and phases.
      await ensureProjectStructure(target);
      if (!integrateIntoExisting) {
        const sourceMeta = await readProjectMeta(source);
        await writeProjectMeta(target, {
          name: path.basename(path.dirname(target)) || 'spin-off',
          color: sourceMeta.color,
          statuses: sourceMeta.statuses,
          rootPhaseIds: [],
        });
      }
      for (const idea of ideasToWrite) {
        await writeIdea(target, idea);
        addIdeaToIndex(target, idea);
      }
      invalidateSemanticCache(target);

      // Prune the source (optional): rewrite kept ideas that lost edges, then
      // delete the exclusive ideas, then clean up dangling phase commitments.
      let deletedFromSource = 0;
      if (input.removeFromSource) {
        for (const idea of sourceIdeasToRewrite) {
          await writeIdea(source, idea);
          updateIdeaInIndex(source, idea);
        }
        for (const id of sourceIdeaIdsToDelete) {
          await deleteIdeaCompletely(source, id);
          deletedFromSource++;
        }
        await cleanupCommitments(source);
        invalidateSemanticCache(source);
      }

      return {
        target,
        copied: ideasToWrite.length,
        deletedFromSource,
        integratedIntoExisting: integrateIntoExisting,
        remappedIds,
        counts: {
          kept: plan.keptIds.length,
          overlap: plan.overlapIds.length,
          spinOff: plan.spinOffIds.length,
        },
      };
    }),
});
