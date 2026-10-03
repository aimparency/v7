import { PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import { countIdeaReferences, findReconciliationCandidates } from "../reconcile.js";
import { extractCodeTokens, scoreCodePresence } from "../code-presence.js";
import type { ToolDefinition } from "./types.js";
import { getRepoCommitMessages, CODE_ONLY_PATHSPEC, gitGrepMatches } from "./git.js";

export const graphHealthTools: ToolDefinition[] = [
  {
    name: "check_consistency",
    description: "Check the idea graph for structural issues: broken links, mismatched parent/child references, orphaned embeddings. Run before fix_consistency.",
    inputSchema: {
      type: "object",
      properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.graphHealth.checkConsistency.query({
        projectPath: args.projectPath as string,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "fix_consistency",
    description: "Auto-repair structural inconsistencies found by check_consistency (rewires broken references).",
    inputSchema: {
      type: "object",
      properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.graphHealth.fixConsistency.mutate({
        projectPath: args.projectPath as string,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "build_search_index",
    description: "Rebuild the text search index and queue background embedding generation for semantic search.",
    inputSchema: {
      type: "object",
      properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.project.buildSearchIndex.mutate({
        projectPath: args.projectPath as string,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "find_duplicate_ideas",
    description: "Scan the embedding index for near-duplicate ideas (all-pairs cosine similarity). Returns ranked pairs above `threshold` (default 0.92). Run build_search_index first if results are empty. Use merge_ideas to act on results.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        threshold: { type: "number", description: "Similarity threshold 0–1 (default 0.92)" },
        limit: { type: "number", description: "Max pairs to return (default 50)" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.graphHealth.findDuplicates.query({
        projectPath: args.projectPath as string,
        threshold: args.threshold as number | undefined,
        limit: args.limit as number | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "suggest_reparents",
    description: "Read-only: for each leaf child of a vague catch-all parent, suggests the closest sub-parent by embedding cosine (default candidates: the catch-all's children that are parents themselves; override with candidateParentIds). Run build_search_index first if empty. Apply with update_idea/merge_ideas.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        parentIdeaId: { type: "string", description: "UUID of the catch-all parent idea" },
        candidateParentIds: { type: "array", items: { type: "string" }, description: "Optional explicit candidate sub-parent UUIDs (default: the catch-all's children that have children)" },
        limit: { type: "number", description: "Max suggestions to return (default 200)" },
      },
      required: ["projectPath", "parentIdeaId"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.graphHealth.suggestReparents.query({
        projectPath: args.projectPath as string,
        parentIdeaId: args.parentIdeaId as string,
        candidateParentIds: args.candidateParentIds as string[] | undefined,
        limit: args.limit as number | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "graph_hygiene",
    description: "Read-only dashboard of graph DEFECTS: floating ideas (no phase AND no parents), mega-parents (catch-all smell, >= megaParentThreshold direct children), stale cancelled/failed/human-dependent ideas, collapse candidates (all active children implemented), and duplicate clusters (cosine >= duplicateThreshold; needs build_search_index). Uncommitted ideas are NOT defects — having no phase is a normal state; browse them with list_ideas uncommitted=true. Act via merge_ideas / suggest_reparents / update_idea.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        megaParentThreshold: { type: "number", description: "Min direct children to flag a mega-parent (default 25)" },
        duplicateThreshold: { type: "number", description: "Cosine threshold for duplicate clusters 0–1 (default 0.92)" },
        limit: { type: "number", description: "Max items per section (default 30)" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.graphHealth.graphHygiene.query({
        projectPath: args.projectPath as string,
        megaParentThreshold: args.megaParentThreshold as number | undefined,
        duplicateThreshold: args.duplicateThreshold as number | undefined,
        limit: args.limit as number | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "reconcile_status",
    description: "Read-only: OPEN ideas cited by >= 1 code commit (8-char id prefix in the message; commits touching only .bowman/ don't count), ranked by commit count — likely implemented but never marked. Check each against the code, then update_idea to implemented with a reflection. A parent may be only partially done; a commit citing an idea as future work is a false positive. Needs a git repo.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        limit: { type: "number", description: "Max candidates to return (default 30)" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const limit = (args.limit as number | undefined) ?? 30;
      const allIdeas = await trpcClient.idea.list.query({
        projectPath: args.projectPath as string,
      });
      const openIdeas = (allIdeas as any[]).filter((a: any) => a.status?.state === "open");
      // Code-only: a graph-bookkeeping commit that merely cites an idea id is
      // not evidence the idea was implemented (see CODE_ONLY_PATHSPEC).
      const commitMessages = getRepoCommitMessages(args.projectPath as string, 2000, CODE_ONLY_PATHSPEC);
      const counts = countIdeaReferences(commitMessages, openIdeas.map((a: any) => a.id));
      const candidates = findReconciliationCandidates(openIdeas as any[], counts);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            gitAvailable: commitMessages.length > 0,
            openIdeas: openIdeas.length,
            candidatesFound: candidates.length,
            note: commitMessages.length === 0
              ? "No git commits found (not a git repo, or no history) — commit-reference reconciliation is unavailable."
              : candidates.length === 0
                ? "No open ideas are referenced by commits. Either the graph is in sync or commits don't cite idea ids."
                : "Each candidate is an OPEN idea cited by a commit — verify against the code, then update_idea to implemented with a reflection if confirmed.",
            candidates: candidates.slice(0, limit),
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "reconcile_code_presence",
    description: "Read-only, noisier complement to reconcile_status: for OPEN ideas no code commit cites, counts how many code-shaped tokens (camelCase/snake_case/dotted/file names) from text+description exist in the codebase (git grep). Ideas >= minScore are flagged as likely implemented, with matched/missing tokens as evidence. Verify against the code before update_idea to implemented. Needs a git repo.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        minScore: { type: "number", description: "Min fraction of an idea's tokens present in code to flag it, 0–1 (default 0.6)" },
        limit: { type: "number", description: "Max candidates to return (default 20)" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const minScore = (args.minScore as number | undefined) ?? 0.6;
      const limit = (args.limit as number | undefined) ?? 20;
      const MAX_TOKENS_PER_IDEA = 12;
      const MAX_UNIQUE_TOKENS = 400;

      const allIdeas = await trpcClient.idea.list.query({ projectPath: args.projectPath as string });
      const openIdeas = (allIdeas as any[]).filter((a: any) => a.status?.state === "open");

      // Ideas already cited by a code commit are reconcile_status's job — skip
      // them so this heuristic focuses on its complement (no commit reference).
      const codeCommits = getRepoCommitMessages(args.projectPath as string, 2000, CODE_ONLY_PATHSPEC);
      const cited = countIdeaReferences(codeCommits, openIdeas.map((a: any) => a.id));
      const ideasToScan = openIdeas.filter((a: any) => !((cited.get(a.id) ?? 0) > 0));

      const tokensByIdea = new Map<string, string[]>();
      const uniqueTokens = new Set<string>();
      for (const a of ideasToScan) {
        const toks = extractCodeTokens(`${a.text}\n${a.description ?? ""}`).slice(0, MAX_TOKENS_PER_IDEA);
        if (toks.length >= 2) {
          tokensByIdea.set(a.id, toks);
          for (const t of toks) if (uniqueTokens.size < MAX_UNIQUE_TOKENS) uniqueTokens.add(t);
        }
      }

      // One git grep per unique token; build the set present in code.
      const present = new Set<string>();
      for (const tok of uniqueTokens) if (gitGrepMatches(args.projectPath as string, tok)) present.add(tok);

      const ideaById = new Map<string, any>(openIdeas.map((a: any) => [a.id, a]));
      const candidates = [...tokensByIdea.entries()]
        .map(([id, toks]) => ({ id, ...scoreCodePresence(toks, present) }))
        .filter((c) => c.scorable && c.score >= minScore && c.matched.length >= 2)
        .sort((x, y) => y.score - x.score)
        .map((c) => ({
          id: c.id,
          text: ideaById.get(c.id)?.text,
          score: Number(c.score.toFixed(2)),
          matched: c.matched,
          missing: c.missing,
        }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            openIdeas: openIdeas.length,
            skippedCommitCited: openIdeas.length - ideasToScan.length,
            scanned: tokensByIdea.size,
            minScore,
            candidatesFound: candidates.length,
            note: "OPEN ideas whose code-shaped tokens are mostly present in the codebase — likely already implemented. Heuristic/noisy (a token can exist for unrelated reasons): verify each against the code using the matched/missing tokens, then update_idea to implemented if confirmed. Ideas cited by a code commit are handled by reconcile_status and skipped here.",
            candidates: candidates.slice(0, limit),
          }, null, 2),
        }],
      };
    },
  },
];
