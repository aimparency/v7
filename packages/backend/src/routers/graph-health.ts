import { z } from 'zod';
import type { Idea, Phase } from 'shared';
import { cosineSimilarity } from 'shared';
import { findDuplicatePairs, clusterDuplicates } from '../duplicate-detection.js';
import { listIdeas, writeIdea, migrateIdeaFiles, scanIdeaFiles } from '../storage/ideas.js';
import { listPhases, writePhase, reconcilePhaseTree } from '../storage/phases.js';
import { loadVectorStore, removeEmbedding } from '../embeddings.js';
import { getDb } from '../db.js';
import { t, delayedProcedure } from '../trpc.js';

type ConsistencyIssueCode =
  | 'idea_nonexistent_phase'
  | 'idea_missing_phase_commitment'
  | 'phase_nonexistent_idea'
  | 'phase_missing_idea_committed_in'
  | 'idea_nonexistent_child'
  | 'idea_missing_child_supported_idea'
  | 'idea_nonexistent_parent'
  | 'idea_missing_parent_supporting_connection'
  | 'orphaned_embedding'
  | 'idea_unreadable'
  | 'legacy';

type ConsistencyIssue = {
  code: ConsistencyIssueCode;
  message: string;
  suggestedAction: string;
};

const CONSISTENCY_ACTIONS: Record<ConsistencyIssueCode, string> = {
  idea_nonexistent_phase: 'Remove invalid phase link',
  idea_missing_phase_commitment: 'Add to phase commitments',
  phase_nonexistent_idea: 'Remove invalid idea commitment',
  phase_missing_idea_committed_in: 'Add to idea committedIn',
  idea_nonexistent_child: 'Remove invalid child link',
  idea_missing_child_supported_idea: 'Sync bidirectional link',
  idea_nonexistent_parent: 'Remove invalid parent link',
  idea_missing_parent_supporting_connection: 'Sync bidirectional link',
  orphaned_embedding: 'Delete orphaned embedding',
  idea_unreadable: 'Repair the file by hand (never auto-fixed; links to it are kept)',
  legacy: 'Auto-fix'
};

function createConsistencyIssue(code: ConsistencyIssueCode, message: string): ConsistencyIssue {
  return {
    code,
    message,
    suggestedAction: CONSISTENCY_ACTIONS[code]
  };
}

export const graphHealthRouter = t.router({
  checkConsistency: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .query(async ({ input }) => {
      // Archived ideas exist too: links to them are not dangling.
      const { ideas, unreadable } = await scanIdeaFiles(input.projectPath, ['ideas', 'archived-ideas']);
      const phases = await listPhases(input.projectPath);
      const issues: ConsistencyIssue[] = [];

      // Files that exist but fail to load are missing from the ideas above.
      // Report them, and never treat links to them as dangling: that would
      // invite fixConsistency to delete those links (as happened on 2026-08-01).
      const unreadableIds = new Set(unreadable.map((file) => file.id));
      for (const file of unreadable) {
        issues.push(createConsistencyIssue('idea_unreadable', `Idea ${file.id} (${file.file}) cannot be loaded: ${file.error}. Fix the file by hand.`));
      }

      const ideaMap = new Map(ideas.map((a: Idea) => [a.id, a]));
      const phaseMap = new Map(phases.map((p: Phase) => [p.id, p]));

      // Check 1: Idea <-> Phase consistency
      for (const idea of ideas) {
        for (const phaseId of idea.committedIn) {
          if (!phaseMap.has(phaseId)) {
            issues.push(createConsistencyIssue(
              'idea_nonexistent_phase',
              `Idea ${idea.id} claims to be committed in non-existent phase ${phaseId}`
            ));
          } else {
            const phase = phaseMap.get(phaseId)!;
            if (!phase.commitments.includes(idea.id)) {
              issues.push(createConsistencyIssue(
                'idea_missing_phase_commitment',
                `Idea ${idea.id} says committed in Phase ${phaseId}, but Phase does not have it in commitments`
              ));
            }
          }
        }
      }

      for (const phase of phases) {
        for (const ideaId of phase.commitments) {
          if (unreadableIds.has(ideaId)) continue;
          if (!ideaMap.has(ideaId)) {
            issues.push(createConsistencyIssue(
              'phase_nonexistent_idea',
              `Phase ${phase.id} commits to non-existent idea ${ideaId}`
            ));
          } else {
            const idea = ideaMap.get(ideaId)!;
            if (!idea.committedIn.includes(phase.id)) {
              issues.push(createConsistencyIssue(
                'phase_missing_idea_committed_in',
                `Phase ${phase.id} commits to Idea ${ideaId}, but Idea does not say committed in Phase`
              ));
            }
          }
        }
      }

      // Check 2: Idea <-> Idea consistency (supportingConnections/supportedIdeas)
      for (const idea of ideas) {
        // supportingConnections (Children)
        if (idea.supportingConnections) {
          for (const conn of idea.supportingConnections) {
              const childId = conn.ideaId;
              if (unreadableIds.has(childId)) continue;
              if (!ideaMap.has(childId)) {
              issues.push(createConsistencyIssue(
                'idea_nonexistent_child',
                `Idea ${idea.id} has non-existent supporting connection (child) ${childId}`
              ));
              } else {
              const child = ideaMap.get(childId)!;
              if (!child.supportedIdeas.includes(idea.id)) {
                  issues.push(createConsistencyIssue(
                    'idea_missing_child_supported_idea',
                    `Idea ${idea.id} lists ${childId} as supporting, but ${childId} does not list ${idea.id} as supportedIdeas`
                  ));
              }
              }
          }
        }

        // supportedIdeas (Parents)
        for (const parentId of idea.supportedIdeas) {
          if (unreadableIds.has(parentId)) continue;
          if (!ideaMap.has(parentId)) {
            issues.push(createConsistencyIssue(
              'idea_nonexistent_parent',
              `Idea ${idea.id} has non-existent supportedIdeas (parent) ${parentId}`
            ));
          } else {
            const parent = ideaMap.get(parentId)!;
            const parentHasConnection = parent.supportingConnections?.some((c) => c.ideaId === idea.id);
            if (!parentHasConnection) {
              issues.push(createConsistencyIssue(
                'idea_missing_parent_supporting_connection',
                `Idea ${idea.id} lists ${parentId} as supportedIdeas, but ${parentId} does not list ${idea.id} in supportingConnections`
              ));
            }
          }
        }
      }

      // Check 4: Embeddings consistency
      const vectorStore = await loadVectorStore(input.projectPath);
      for (const ideaId of Object.keys(vectorStore)) {
          if (!ideaMap.has(ideaId) && !unreadableIds.has(ideaId)) {
              issues.push(createConsistencyIssue(
                'orphaned_embedding',
                `Orphaned embedding found for Idea ${ideaId}`
              ));
          }
      }

      return { valid: issues.length === 0, errors: issues.map((issue) => issue.message), issues };
    }),

  fixConsistency: delayedProcedure
    .input(z.object({
      projectPath: z.string()
    }))
    .mutation(async ({ input }) => {
      const fixes: string[] = [];
      // Reads no longer upgrade idea files as a side effect; persist it here.
      for (const ideaId of await migrateIdeaFiles(input.projectPath)) {
        fixes.push(`Upgraded legacy fields / placed connections of Idea ${ideaId}`);
      }
      fixes.push(...await reconcilePhaseTree(input.projectPath));

      // Archived ideas exist too: links to them are not dangling.
      const { ideas, unreadable } = await scanIdeaFiles(input.projectPath, ['ideas', 'archived-ideas']);
      const phases = await listPhases(input.projectPath);

      const ideaMap = new Map(ideas.map((a: Idea) => [a.id, a]));
      // Unreadable ideas still exist: keep every link to them (see checkConsistency).
      const unreadableIds = new Set(unreadable.map((file) => file.id));
      const phaseMap = new Map(phases.map((p: Phase) => [p.id, p]));

      // Fix 1: Idea <-> Phase consistency
      for (const idea of ideas) {
        const originalCommittedIn = [...idea.committedIn];
        idea.committedIn = idea.committedIn.filter((phaseId: string) => {
          const phase = phaseMap.get(phaseId);
          if (!phase) {
            fixes.push(`Removed non-existent phase ${phaseId} from Idea ${idea.id}`);
            return false;
          }
          if (!phase.commitments.includes(idea.id)) {
            fixes.push(`Removed phase ${phaseId} from Idea ${idea.id} (not in phase commitments)`);
            return false;
          }
          return true;
        });

        if (idea.committedIn.length !== originalCommittedIn.length) {
          await writeIdea(input.projectPath, idea);
        }
      }

      for (const phase of phases) {
        const validCommitments = [];
        for (const ideaId of phase.commitments) {
          if (unreadableIds.has(ideaId)) {
            validCommitments.push(ideaId);
            continue;
          }
          const idea = ideaMap.get(ideaId);
          if (!idea) {
            fixes.push(`Removed non-existent idea ${ideaId} from Phase ${phase.id}`);
            continue;
          }
          validCommitments.push(ideaId);

          if (!idea.committedIn.includes(phase.id)) {
            idea.committedIn.push(phase.id);
            await writeIdea(input.projectPath, idea);
            fixes.push(`Added phase ${phase.id} to Idea ${idea.id}`);
          }
        }

        if (validCommitments.length !== phase.commitments.length) {
          phase.commitments = validCommitments;
          await writePhase(input.projectPath, phase);
        }
      }

      // Fix 2: Idea <-> Idea consistency
      for (const idea of ideas) {
        // supportingConnections (Children)
        if (idea.supportingConnections) {
          const validConnections = [];
          for (const conn of idea.supportingConnections) {
              const childId = conn.ideaId;
              if (unreadableIds.has(childId)) {
              validConnections.push(conn);
              continue;
              }
              const child = ideaMap.get(childId);
              if (!child) {
              fixes.push(`Removed non-existent child ${childId} from Idea ${idea.id}`);
              continue;
              }
              validConnections.push(conn);

              if (!child.supportedIdeas.includes(idea.id)) {
              child.supportedIdeas.push(idea.id);
              await writeIdea(input.projectPath, child);
              fixes.push(`Added supportedIdeas parent ${idea.id} to Child ${child.id}`);
              }
          }
          if (validConnections.length !== idea.supportingConnections.length) {
              idea.supportingConnections = validConnections;
              await writeIdea(input.projectPath, idea);
          }
        }

        // supportedIdeas (Parents)
        const validSupportedIdeas = [];
        for (const parentId of idea.supportedIdeas) {
          if (unreadableIds.has(parentId)) {
            validSupportedIdeas.push(parentId);
            continue;
          }
          const parent = ideaMap.get(parentId);
          if (!parent) {
            fixes.push(`Removed non-existent parent ${parentId} from Idea ${idea.id}`);
            continue;
          }
          validSupportedIdeas.push(parentId);

          if (!parent.supportingConnections) parent.supportingConnections = [];
          if (!parent.supportingConnections.some((c) => c.ideaId === idea.id)) {
            parent.supportingConnections.push({ ideaId: idea.id, relativePosition: [0,0], weight: 1 });
            await writeIdea(input.projectPath, parent);
            fixes.push(`Added supporting connection ${idea.id} to Parent ${parent.id}`);
          }
        }
        if (validSupportedIdeas.length !== idea.supportedIdeas.length) {
          idea.supportedIdeas = validSupportedIdeas;
          await writeIdea(input.projectPath, idea);
        }
      }

      // Fix 3: Phase parent consistency
      for (const phase of phases) {
        if (phase.parent) {
          if (!phaseMap.has(phase.parent)) {
            fixes.push(`Removed non-existent parent phase ${phase.parent} from Phase ${phase.id}`);
            phase.parent = null;
            await writePhase(input.projectPath, phase);
          }
        }
      }

      // Fix 4: Embeddings consistency
      const vectorStore = await loadVectorStore(input.projectPath);
      for (const ideaId of Object.keys(vectorStore)) {
          if (!ideaMap.has(ideaId) && !unreadableIds.has(ideaId)) {
              await removeEmbedding(input.projectPath, ideaId);
              fixes.push(`Removed orphaned embedding for Idea ${ideaId}`);
          }
      }

      // Fix 5: Cache consistency (idea_values)
      try {
          const db = getDb(input.projectPath);
          const validIds = Array.from(ideaMap.keys());
          if (validIds.length > 0) {
              const placeholders = validIds.map(() => '?').join(',');
              const info = db.prepare(`DELETE FROM idea_values WHERE id NOT IN (${placeholders})`).run(...validIds);
              if (info.changes > 0) {
                  fixes.push(`Removed ${info.changes} orphaned entries from idea_values cache`);
              }
          } else {
              // No ideas, clear cache
              const info = db.prepare('DELETE FROM idea_values').run();
              if (info.changes > 0) {
                  fixes.push(`Cleared ${info.changes} entries from idea_values cache (no valid ideas)`);
              }
          }
      } catch (e) {
          console.error('Failed to clean idea_values cache:', e);
          fixes.push('Failed to clean idea_values cache (see logs)');
      }

      return { success: true, fixes };
    }),

  // Read-only duplicate report: loads all vectors in one pass, computes
  // all-pairs cosine similarity, returns pairs above `threshold` ranked by score.
  // Use merge_ideas to act on the results.
  findDuplicates: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      threshold: z.number().min(0).max(1).optional(), // default 0.92 (calibrated for bge-small-en-v1.5 on the live ~565-idea graph)
      limit: z.number().int().positive().optional(),   // default 50
    }))
    .query(async ({ input }) => {
      const threshold = input.threshold ?? 0.92;
      const limit = input.limit ?? 50;

      const [ideas, vectorStore] = await Promise.all([
        listIdeas(input.projectPath),
        loadVectorStore(input.projectPath),
      ]);

      const ideaMap = new Map<string, Idea>(ideas.map((a: Idea) => [a.id, a]));

      // Build indexed list of (ideaId, vector) for active ideas only
      const indexed: Array<{ id: string; vector: number[] }> = [];
      for (const [id, vector] of Object.entries(vectorStore)) {
        if (Array.isArray(vector) && vector.length > 0 && ideaMap.has(id)) {
          indexed.push({ id, vector: vector as number[] });
        }
      }

      // Ranked near-duplicate pairs (parent-child pairs excluded — see
      // duplicate-detection.ts). Mapped to the report shape.
      const ranked = findDuplicatePairs(indexed, ideaMap, threshold);
      const pairs = ranked.map((p) => ({
        score: p.score.toFixed(4),
        aId: p.aId,
        aText: ideaMap.get(p.aId)!.text,
        bId: p.bId,
        bText: ideaMap.get(p.bId)!.text,
      }));
      const topPairs = pairs.slice(0, limit);

      return {
        threshold,
        totalIndexed: indexed.length,
        totalIdeas: ideas.length,
        unindexed: ideas.length - indexed.length,
        pairsFound: pairs.length,
        pairs: topPairs,
        note: indexed.length === 0
          ? 'No embeddings found. Run build_search_index first.'
          : pairs.length === 0
            ? `No pairs above threshold ${threshold}. Try lowering it.`
            : undefined,
      };
    }),

  // Read-only reparent suggestions: for each leaf child of a vague catch-all parent,
  // suggest the closest structural sub-parent (by embedding cosine) to move it under.
  // Candidate sub-parents default to the catch-all's children that are themselves
  // parents; pass candidateParentIds to override. Apply via merge/move tooling — this
  // is an approve-a-list report, it changes nothing.
  suggestReparents: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      parentIdeaId: z.string(),                              // the catch-all parent
      candidateParentIds: z.array(z.string()).optional(),   // override structural sub-parents
      limit: z.number().int().positive().optional(),        // default 200
    }))
    .query(async ({ input }) => {
      const limit = input.limit ?? 200;
      const [ideas, vectorStore] = await Promise.all([
        listIdeas(input.projectPath),
        loadVectorStore(input.projectPath),
      ]);
      const ideaMap = new Map<string, Idea>(ideas.map((a: Idea) => [a.id, a]));
      const catchAll = ideaMap.get(input.parentIdeaId);
      if (!catchAll) {
        return { error: `Catch-all parent ${input.parentIdeaId} not found.` };
      }

      const vecOf = (id: string): number[] | undefined => {
        const v = vectorStore[id];
        return Array.isArray(v) && v.length > 0 ? (v as number[]) : undefined;
      };

      // Direct children of the catch-all = ideas that support it.
      const childIds: string[] = (catchAll.supportingConnections ?? [])
        .map((c) => c.ideaId)
        .filter((id: string) => ideaMap.has(id));

      const isParent = (id: string) => (ideaMap.get(id)?.supportingConnections?.length ?? 0) > 0;

      // Candidate sub-parents: explicit, else the catch-all's children that are parents.
      const candidateIds: string[] = (input.candidateParentIds ?? childIds.filter(isParent))
        .filter((id: string) => ideaMap.has(id));

      // A candidate's "meaning" is best represented by what it already contains: the
      // centroid of its children's embeddings. Fall back to its own title embedding
      // when it has no embedded children.
      const candidates = candidateIds.map((id: string) => {
        const childVecs = (ideaMap.get(id)?.supportingConnections ?? [])
          .map((c) => vecOf(c.ideaId))
          .filter((v): v is number[] => !!v);
        let vector: number[] | undefined;
        const firstVec = childVecs[0];
        if (firstVec) {
          const dim = firstVec.length;
          const vec = new Array<number>(dim).fill(0);
          for (const v of childVecs) {
            for (let i = 0; i < dim; i++) {
              const currentVal = vec[i] ?? 0;
              const childVal = v[i] ?? 0;
              vec[i] = currentVal + childVal / childVecs.length;
            }
          }
          vector = vec;
        } else {
          vector = vecOf(id);
        }
        return { id, text: ideaMap.get(id)!.text, vector };
      }).filter((c) => c.vector) as Array<{ id: string; text: string; vector: number[] }>;

      const candidateSet = new Set(candidateIds);
      const leafIds = childIds.filter((id: string) => !candidateSet.has(id));

      const suggestions: any[] = [];
      let unembeddedLeaves = 0;
      for (const leafId of leafIds) {
        const lv = vecOf(leafId);
        if (!lv) { unembeddedLeaves++; continue; }
        let best: { id: string; text: string; score: number } | undefined;
        let runnerUp: { id: string; text: string; score: number } | undefined;
        for (const cand of candidates) {
          if (cand.id === leafId || cand.vector.length !== lv.length) continue;
          const score = cosineSimilarity(lv, cand.vector);
          if (!best || score > best.score) { runnerUp = best; best = { id: cand.id, text: cand.text, score }; }
          else if (!runnerUp || score > runnerUp.score) { runnerUp = { id: cand.id, text: cand.text, score }; }
        }
        if (best) {
          suggestions.push({
            scoreRaw: best.score,
            leafId,
            leafText: ideaMap.get(leafId)!.text,
            suggestedParentId: best.id,
            suggestedParentText: best.text,
            score: best.score.toFixed(4),
            margin: runnerUp ? (best.score - runnerUp.score).toFixed(4) : undefined,
            runnerUpId: runnerUp?.id,
            runnerUpText: runnerUp?.text,
          });
        }
      }

      suggestions.sort((a, b) => b.scoreRaw - a.scoreRaw);
      const top = suggestions.slice(0, limit).map(({ scoreRaw: _, ...rest }) => rest);

      return {
        catchAllParent: { id: catchAll.id, text: catchAll.text },
        candidateParents: candidates.map((c) => ({ id: c.id, text: c.text })),
        totalChildren: childIds.length,
        leafCount: leafIds.length,
        unembeddedLeaves,
        suggestionsCount: suggestions.length,
        suggestions: top,
        note: candidates.length === 0
          ? 'No candidate structural sub-parents found. Pass candidateParentIds, or ensure the catch-all has sub-parent children with embeddings (run build_search_index).'
          : suggestions.length === 0
            ? 'No leaf children to reparent (or none embedded). Run build_search_index first.'
            : undefined,
      };
    }),

  // Read-only graph-hygiene dashboard: surfaces where the idea graph needs maintenance —
  // floating ideas, mega-parents (catch-all smell), stale cancelled/failed/human-dependent
  // ideas, collapse candidates (parents whose active children are all done), and
  // duplicate clusters. Changes nothing; pairs with merge_ideas / suggest_reparents / archiving.
  graphHygiene: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      megaParentThreshold: z.number().int().positive().optional(), // default 25
      duplicateThreshold: z.number().min(0).max(1).optional(),     // default 0.92 (calibrated for bge-small-en-v1.5 on the live ~565-idea graph)
      limit: z.number().int().positive().optional(),               // per-section cap, default 30
    }))
    .query(async ({ input }) => {
      const megaParentThreshold = input.megaParentThreshold ?? 25;
      const duplicateThreshold = input.duplicateThreshold ?? 0.92;
      const limit = input.limit ?? 30;

      const [ideas, vectorStore] = await Promise.all([
        listIdeas(input.projectPath),
        loadVectorStore(input.projectPath),
      ]);
      const ideaMap = new Map<string, Idea>(ideas.map((a: Idea) => [a.id, a]));
      const active = ideas.filter((a: Idea) => !a.archived);

      const childIdsOf = (a: Idea): string[] =>
        (a.supportingConnections ?? []).map((c) => c.ideaId).filter((id: string) => ideaMap.has(id));

      // 1. Floating: no parents and not committed to any phase.
      const floating = active
        .filter((a: Idea) => (a.supportedIdeas?.length ?? 0) === 0 && (a.committedIn?.length ?? 0) === 0)
        .map((a: Idea) => ({ id: a.id, text: a.text, status: a.status.state }));

      // NOTE: uncommitted-open ideas are deliberately NOT a section here. Every
      // other section is a defect, so listing them made a normal state read as
      // one, and a count in a hygiene report is an implicit target to drive to
      // zero — which here means phase-committing ideas nobody intends to act on.
      // An idea with a parent contributes through that parent; get_prioritized_ideas
      // ranks these when a phase holds no open leaf, and idea.list({uncommitted})
      // browses them on purpose. See idea 6f9bef89.

      // 2. Mega-parents: too many direct children (catch-all smell).
      const megaParents = active
        .map((a: Idea) => ({ a, n: childIdsOf(a).length }))
        .filter((x) => x.n >= megaParentThreshold)
        .sort((x, y) => y.n - x.n)
        .map((x) => ({ id: x.a.id, text: x.a.text, directChildren: x.n }));

      // 3. Stale-status: cancelled/failed/human-dependent but not archived (clutter).
      const staleStates = new Set(['cancelled', 'failed', 'human-dependent']);
      const staleStatus = active
        .filter((a: Idea) => staleStates.has(a.status.state))
        .map((a: Idea) => ({ id: a.id, text: a.text, status: a.status.state }));

      // 4. Collapse candidates: parents whose active children are ALL done.
      const collapseCandidates = active
        .map((a: Idea) => {
          const kids = childIdsOf(a).map((id) => ideaMap.get(id)!).filter((k) => !k.archived);
          const done = kids.filter((k) => k.status.state === 'implemented').length;
          return { a, total: kids.length, done };
        })
        .filter((x) => x.total > 0 && x.done === x.total)
        .map((x) => ({ id: x.a.id, text: x.a.text, doneChildren: x.done, totalChildren: x.total }));

      // 5. Duplicate clusters: all-pairs cosine above threshold, grouped via
      // union-find (parent-child pairs excluded — see duplicate-detection.ts).
      const indexedIds = active
        .map((a: Idea) => a.id)
        .filter((id: string) => Array.isArray(vectorStore[id]) && (vectorStore[id] as number[]).length > 0);
      const duplicateClusters = clusterDuplicates(
        indexedIds,
        (id) => vectorStore[id] as number[] | undefined,
        ideaMap,
        duplicateThreshold,
      ).map((c) => c.map((id) => ({ id, text: ideaMap.get(id)!.text })));

      const section = <T>(items: T[]) => ({ count: items.length, items: items.slice(0, limit) });

      return {
        totalIdeas: ideas.length,
        activeIdeas: active.length,
        thresholds: { megaParentThreshold, duplicateThreshold },
        floating: section(floating),
        megaParents: section(megaParents),
        staleStatus: section(staleStatus),
        collapseCandidates: section(collapseCandidates),
        duplicateClusters: section(duplicateClusters),
      };
    })
});
