import { calculateIdeaValues, type Idea } from "shared";
import { IDEA_STATES_DESCRIPTION, PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import type { BackendInputs } from "../client.js";
import type { ToolDefinition } from "./types.js";
import { formatIdea, formatIdeas, describeRepoEdges } from "./format.js";
import { connectionInputSchema, normalizeConnectionInput, toStoredConnection, type ConnectionInput } from "./connections.js";
import { createHash } from "crypto";

/**
 * Verification evidence expected before an idea may be 'implemented', tailored to the
 * idea's apparent type (inferred from text/description/tags). Keeps the soft
 * implemented-gate concrete — "implemented = verified, not claimed" — instead of a
 * generic reminder. Exported for unit testing.
 */
export function verificationHintForIdea(
  idea: { text?: string; description?: string; tags?: string[] } | null | undefined,
): string {
  const hay = `${idea?.text ?? ""} ${idea?.description ?? ""} ${(idea?.tags ?? []).join(" ")}`.toLowerCase();
  const has = (re: RegExp) => re.test(hay);
  // UI/visual first: a change to something visual is best proven by seeing it run.
  if (has(/\b(ui|visual|render|screenshot|css|layout|animation|colou?rs?|button|modal|flicker|paint|style|icon|badge|dropdown|graph view)\b/))
    return "a screenshot or interaction proof that you saw it working in the running app";
  if (has(/\b(bug|fix|repro|broken|regression|crash|incorrect|wrong|stale|leak|race)\b/))
    return "a repro that now passes — the previously-failing case, now green";
  if (has(/\b(refactor|implement|backend|api|tool|schema|mcp|endpoint|function|module|migration|test|type-?check)\b/))
    return "tests + typecheck passing — cite exactly what you ran";
  return "what you ran/checked to confirm it actually works — tests, a repro, or a screenshot";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function ideaCreationConfirmationToken(args: Record<string, unknown>): string {
  const { confirmationToken: _confirmationToken, ...proposal } = args;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(proposal)))
    .digest("hex")
    .slice(0, 24);
}

export const ideaTools: ToolDefinition[] = [
  {
    name: "get_idea",
    description: "Get one idea's raw fields by ID. To orient before working on it, prefer get_idea_context.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string" }
      },
      required: ["projectPath", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      const idea = await trpcClient.idea.get.query({
        projectPath: args.projectPath as string,
        ideaId: args.ideaId as string,
      });
      await describeRepoEdges(trpcClient, args.projectPath as string, [idea]);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatIdea(idea), null, 2),
          },
        ],
      };
    },
  },
  {
    name: "get_idea_context",
    description: "Orient before acting: returns the idea, every distinct root-first mission path (paths_to_root), the backward-compatible highest-value path (path_to_root), related ideas, immediate parents, and children. Cyclic/non-root branches are excluded and truncation is reported.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string" }
      },
      required: ["projectPath", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      const ideaId = args.ideaId as string;
      const projectPath = args.projectPath as string;
      const MAX_PATH_DEPTH = 64;
      const MAX_PATHS = 100;

      // Load the whole graph once: it powers the value model (to choose
      // which parent to follow at branches) and lets us resolve parent/child
      // text from a map instead of N round-trips.
      const allIdeas = await trpcClient.idea.list.query({ projectPath });
      const ideaMap = new Map(allIdeas.map((a) => [a.id, a]));
      const { flowValues } = calculateIdeaValues(allIdeas);

      const idea = ideaMap.get(ideaId) || await trpcClient.idea.get.query({ projectPath, ideaId });

      // Semantic Search
      const queryText = `${idea.text} ${idea.description || ''}`.trim();
      const similarIdeas = await trpcClient.idea.searchSemantic.query({
        projectPath,
        query: queryText,
        limit: 6 // Request 6, filter self
      });
      const semanticContext = similarIdeas
        .filter((a) => a.id !== ideaId)
        .slice(0, 5)
        .map((a) => ({ id: a.id, text: a.text, description: a.description }));

      // Immediate parents (an idea may have several)
      const parentContext = (idea.supportedIdeas || [])
        .flatMap((id) => ideaMap.get(id) ?? [])
        .map((p) => ({ id: p.id, text: p.text, description: p.description }));

      // Children
      const childContext = (idea.supportingConnections || [])
        .flatMap((c) => ideaMap.get(c.ideaId) ?? [])
        .map((c) => ({ id: c.id, text: c.text, description: c.description }));

      // Black-box repo supporters: whole external repos carrying part of
      // this idea. They are not in ideaMap (nothing inside them is loaded, by
      // design), so they would be invisible without this.
      const repoCarrier = { supportingRepos: [...(idea.supportingRepos || [])] };
      await describeRepoEdges(trpcClient, projectPath, [repoCarrier]);
      const repoContext = repoCarrier.supportingRepos;

      // Highest-value path to root: walk up supportedIdeas so the agent sees
      // lineage toward the highest-value goal (e.g. "achieve ASI"). At a
      // branch (multiple parents) follow the one with the highest actual
      // value inflow into the current idea — i.e. the parent through which
      // most value flows here. Cycle-guarded and capped at MAX_PATH.
      type PathStep = { id: string; text: string; description?: string; intrinsicValue: number; valueInflow: number };
      const pathToRoot: PathStep[] = [];
      const visited = new Set<string>([ideaId]);
      let cursor: Idea = idea;
      while (pathToRoot.length < MAX_PATH_DEPTH) {
        const parentIds = cursor.supportedIdeas.filter(
          (id) => ideaMap.has(id) && !visited.has(id)
        );
        if (parentIds.length === 0) break; // reached a root (or only cycles remain)

        // Pick the parent with the greatest value inflow into `cursor`.
        let best = parentIds[0];
        let bestFlow = flowValues.get(`${best}->${cursor.id}`) ?? 0;
        for (const pid of parentIds) {
          const flow = flowValues.get(`${pid}->${cursor.id}`) ?? 0;
          if (flow > bestFlow) { best = pid; bestFlow = flow; }
        }

        const parent = ideaMap.get(best)!;
        visited.add(best);
        pathToRoot.push({
          id: parent.id,
          text: parent.text,
          description: parent.description,
          intrinsicValue: parent.intrinsicValue ?? 0,
          valueInflow: Number(bestFlow.toFixed(4)),
        });
        cursor = parent;
      }
      // Order root-first so the north-star goal reads at the top.
      pathToRoot.reverse();

      // All distinct root paths. Keep a visited set per branch so a node
      // shared by several legitimate paths appears in each, while cycles
      // cannot masquerade as roots. Bounds are explicit in the response.
      const pathsToRoot: PathStep[][] = [];
      let pathsToRootTruncated = false;
      const walkAllParents = (
        current: Idea,
        upwardPath: PathStep[],
        branchVisited: Set<string>
      ) => {
        if (pathsToRoot.length >= MAX_PATHS) {
          pathsToRootTruncated = true;
          return;
        }
        if (upwardPath.length >= MAX_PATH_DEPTH) {
          pathsToRootTruncated = true;
          return;
        }

        const existingParentIds = current.supportedIdeas
          .filter((id) => ideaMap.has(id));
        if (existingParentIds.length === 0) {
          pathsToRoot.push([...upwardPath].reverse());
          return;
        }

        let followedParent = false;
        for (const parentId of existingParentIds) {
          if (branchVisited.has(parentId)) continue;
          followedParent = true;
          const parent = ideaMap.get(parentId)!;
          const flow = flowValues.get(`${parentId}->${current.id}`) ?? 0;
          walkAllParents(
            parent,
            [...upwardPath, {
              id: parent.id,
              text: parent.text,
              description: parent.description,
              intrinsicValue: parent.intrinsicValue ?? 0,
              valueInflow: Number(flow.toFixed(4)),
            }],
            new Set([...branchVisited, parentId])
          );
        }
        if (!followedParent) {
          // Every branch closes a cycle; this is not a path to a root.
          return;
        }
      };
      walkAllParents(idea, [], new Set([ideaId]));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
                idea: { id: idea.id, text: idea.text, description: idea.description },
                path_to_root: pathToRoot,
                paths_to_root: pathsToRoot,
                paths_to_root_truncated: pathsToRootTruncated,
                semantic_context: semanticContext,
                parents: parentContext,
                children: childContext,
                supporting_repos: repoContext
            }, null, 2),
          },
        ],
      };
    },
  },
  {
    name: "search_ideas",
    description: "Search ideas by text/status. Empty query = most recently updated. Search before creating a new idea to avoid duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        query: { type: "string" },
        status: { type: ["string", "array"], items: { type: "string" } },
        phaseId: { type: "string" },
        archived: { type: "boolean" },
        limit: { type: "number" },
        offset: { type: "number" }
      },
      required: ["projectPath", "query"],
    },
    handler: async (args, trpcClient) => {
      const ideas = await trpcClient.idea.search.query({
        projectPath: args.projectPath as string,
        query: args.query as string,
        status: args.status as string | string[] | undefined,
        phaseId: args.phaseId as string | undefined,
        archived: args.archived as boolean | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatIdeas(ideas), null, 2),
          },
        ],
      };
    },
  },
  {
    name: "search_ideas_semantic",
    description: "Search ideas by semantic similarity (embedding-based). Requires build_search_index to have run. Useful for finding duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        query: { type: "string" },
        status: { type: ["string", "array"], items: { type: "string" } },
        phaseId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["projectPath", "query"],
    },
    handler: async (args, trpcClient) => {
      const results = await trpcClient.idea.searchSemantic.query({
        projectPath: args.projectPath as string,
        query: args.query as string,
        status: args.status as string | string[] | undefined,
        phaseId: args.phaseId as string | undefined,
        limit: args.limit as number | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(results.map(formatIdea), null, 2) }],
      };
    },
  },
  {
    name: "create_idea",
    description: "Two-step creation: first call returns related active/cancelled ideas and a confirmationToken without writing. Review that context, then repeat the identical call with confirmationToken to create. Similarity informs judgment; it does not forbid a genuinely distinct idea. Connect the idea to the mission it serves.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        text: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        status: {
          type: "object",
          properties: {
            state: { type: "string", description: IDEA_STATES_DESCRIPTION },
            comment: { type: "string" },
            reviewedAt: { type: "number", description: "Timestamp confirming status and intention still hold (keeps the transition date)." },
          },
        },
        supportingConnections: connectionInputSchema("Child ideas: UUIDs or { ideaId, weight, explanation }."),
        supportedIdeas: connectionInputSchema("Parent ideas this one serves: UUIDs or { ideaId, weight, explanation } for the parent→new-idea edge."),
        intrinsicValue: { type: "number", minimum: 0, description: "Standalone estimated value; includes expected partial completion or failure" },
        valueRationale: { type: "string", description: "Human-authored rationale for the standalone estimated value; never auto-derived" },
        cost: { type: "number", exclusiveMinimum: 0, description: "Positive estimated direct present cost in the project's cost unit (see get_prioritized_ideas economics); omitted = project default" },
        duration: { type: "number", minimum: 0, description: "Estimated days from now until the idea's value is realized" },
        phaseId: { type: "string" },
        confirmationToken: { type: "string", description: "Token returned by the review-only first call. Any proposal edit requires a fresh review." },
      },
      required: ["projectPath", "text"],
    },
    handler: async (args, trpcClient) => {
      if (args.cost !== undefined && (!Number.isFinite(args.cost) || (args.cost as number) <= 0)) {
        throw new Error("Estimated direct cost must be a finite number greater than 0.");
      }
      if (args.duration !== undefined && (!Number.isFinite(args.duration) || (args.duration as number) < 0)) {
        throw new Error("Duration must be a finite number greater than or equal to 0 days.");
      }
      const expectedToken = ideaCreationConfirmationToken(args);
      if (args.confirmationToken === undefined) {
        const related = await trpcClient.idea.search.query({
          projectPath: args.projectPath as string,
          query: args.text as string,
          limit: 8,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              created: false,
              reviewRequired: true,
              confirmationToken: expectedToken,
              instruction:
                "Review the related ideas, especially cancelled ones and their reasons. " +
                "Reuse, update, connect, or merge when appropriate. If this proposal is still distinct and useful, " +
                "repeat the identical create_idea call with confirmationToken.",
              relatedIdeas: related.map((idea) => ({
                id: idea.id,
                text: idea.text,
                description: idea.description,
                status: idea.status,
                score: idea.score,
              })),
            }, null, 2),
          }],
        };
      }
      if (args.confirmationToken !== expectedToken) {
        throw new Error(
          "confirmationToken does not match this idea proposal. " +
          "Call create_idea again without confirmationToken to review context for the edited proposal.",
        );
      }

      const result = await trpcClient.idea.createFloatingIdea.mutate({
        projectPath: args.projectPath as string,
        idea: {
          text: args.text as string,
          description: args.description as string | undefined,
          tags: args.tags as string[] | undefined,
          status: (args.status as BackendInputs["idea"]["createFloatingIdea"]["idea"]["status"]) || {
            state: "open",
            comment: "",
            date: Date.now(),
          },
          intrinsicValue: args.intrinsicValue as number | undefined,
          valueRationale: args.valueRationale as string | undefined,
          cost: args.cost as number | undefined,
          duration: args.duration as number | undefined,
        },
      });

      // Handle supportingConnections (children)
      const children = (args.supportingConnections as ConnectionInput[]) || [];
      for (const childInput of children) {
        const child = normalizeConnectionInput(childInput);
        await trpcClient.idea.connectIdeas.mutate({
          projectPath: args.projectPath as string,
          parentIdeaId: result.id,
          childIdeaId: child.ideaId,
          weight: child.weight,
          explanation: child.explanation,
        });
      }

      // Handle supportedIdeas (parents)
      const parents = (args.supportedIdeas as ConnectionInput[]) || [];
      for (const parentInput of parents) {
        const parent = normalizeConnectionInput(parentInput);
        await trpcClient.idea.connectIdeas.mutate({
          projectPath: args.projectPath as string,
          parentIdeaId: parent.ideaId,
          childIdeaId: result.id,
          weight: parent.weight,
          explanation: parent.explanation,
        });
      }

      // If phaseId provided, commit to phase
      if (args.phaseId) {
        await trpcClient.idea.commitToPhase.mutate({
          projectPath: args.projectPath as string,
          ideaId: result.id,
          phaseId: args.phaseId as string,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Created idea with ID: ${result.id}${args.phaseId ? ` and committed to phase ${args.phaseId}` : ''}`,
          },
        ],
      };
    },
  },
  {
    name: "update_idea",
    description: "Update idea fields; only the given ones change. Links change through add*/remove*. reflection is a free-text note; set it with status=implemented to record verification evidence (verified-done, not claimed-done). When blocked set unclear/human-dependent with a comment.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string" },
        text: { type: "string" },
        description: { type: "string" },
        reflection: { type: "string", description: "Free-text note/reflection on the idea; can be updated together with status without changing other fields." },
        tags: { type: "array", items: { type: "string" } },
        status: {
          type: "object",
          properties: {
            state: { type: "string", description: IDEA_STATES_DESCRIPTION },
            comment: { type: "string" },
            reviewedAt: { type: "number", description: "Timestamp confirming status and intention still hold (keeps the transition date)." },
          },
        },
        addSupportingConnections: connectionInputSchema("Add child links, or update weight/explanation of existing ones."),
        removeSupportingConnections: { type: "array", items: { type: "string" }, description: "Child idea UUIDs to unlink." },
        addSupportedIdeas: connectionInputSchema("Add parent links, or update weight/explanation of the parent→this-idea edge."),
        removeSupportedIdeas: { type: "array", items: { type: "string" }, description: "Parent idea UUIDs to unlink." },
        intrinsicValue: { type: "number", minimum: 0, description: "Standalone estimated value; includes expected partial completion or failure" },
        valueRationale: { type: "string", description: "Human-authored rationale for the standalone estimated value; never auto-derived" },
        cost: { type: "number", exclusiveMinimum: 0, description: "Positive estimated direct present cost in the project's cost unit (see get_prioritized_ideas economics); omitted = project default" },
        duration: { type: "number", minimum: 0, description: "Estimated days from now until the idea's value is realized" },
      },
      required: ["projectPath", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      // The backend validates these; the tool schema above already names them.
      const fields = args as BackendInputs["idea"]["update"]["idea"];
      const updateData: BackendInputs["idea"]["update"]["idea"] = {};
      if (fields.text) updateData.text = fields.text;
      if (fields.description !== undefined) updateData.description = fields.description;
      if (fields.reflection !== undefined) updateData.reflection = fields.reflection;
      if (fields.tags) updateData.tags = fields.tags;
      if (fields.status) updateData.status = fields.status;
      if (fields.intrinsicValue !== undefined) updateData.intrinsicValue = fields.intrinsicValue;
      if (fields.valueRationale !== undefined) updateData.valueRationale = fields.valueRationale;
      if (fields.cost !== undefined) updateData.cost = fields.cost;
      if (fields.duration !== undefined) updateData.duration = fields.duration;

      const parentMetadataToApply: Array<{ parentIdeaId: string; weight?: number; explanation?: string }> = [];

      if (args.addSupportingConnections !== undefined || args.removeSupportingConnections !== undefined ||
          args.addSupportedIdeas !== undefined || args.removeSupportedIdeas !== undefined) {
        const existingIdea = await trpcClient.idea.get.query({
          projectPath: args.projectPath as string,
          ideaId: args.ideaId as string,
        });

        if (args.addSupportingConnections !== undefined || args.removeSupportingConnections !== undefined) {
          const byChildId = new Map();
          for (const conn of existingIdea.supportingConnections ?? []) {
            byChildId.set(conn.ideaId, { ...conn });
          }
          for (const childId of (args.removeSupportingConnections as string[] | undefined) ?? []) {
            byChildId.delete(childId);
          }
          for (const input of (args.addSupportingConnections as ConnectionInput[] | undefined) ?? []) {
            const next = toStoredConnection(input);
            byChildId.set(next.ideaId, { ...(byChildId.get(next.ideaId) ?? {}), ...next });
          }
          updateData.supportingConnections = Array.from(byChildId.values());
        }

        if (args.addSupportedIdeas !== undefined || args.removeSupportedIdeas !== undefined) {
          const parentIds = new Set<string>(existingIdea.supportedIdeas ?? []);
          for (const parentId of (args.removeSupportedIdeas as string[] | undefined) ?? []) {
            parentIds.delete(parentId);
          }
          for (const input of (args.addSupportedIdeas as ConnectionInput[] | undefined) ?? []) {
            const parent = normalizeConnectionInput(input);
            parentIds.add(parent.ideaId);
            if (typeof input !== "string") {
              parentMetadataToApply.push({ parentIdeaId: parent.ideaId, weight: parent.weight, explanation: parent.explanation });
            }
          }
          updateData.supportedIdeas = Array.from(parentIds);
        }
      }

      await trpcClient.idea.update.mutate({
        projectPath: args.projectPath as string,
        ideaId: args.ideaId as string,
        idea: updateData,
      });

      for (const parent of parentMetadataToApply) {
        if (parent.weight === undefined && parent.explanation === undefined) continue;

        const parentIdea = await trpcClient.idea.get.query({
          projectPath: args.projectPath as string,
          ideaId: parent.parentIdeaId,
        });
        const childIdeaId = args.ideaId as string;
        const supportingConnections = [...(parentIdea.supportingConnections ?? [])];
        const existingIndex = supportingConnections.findIndex((conn) => conn.ideaId === childIdeaId);
        const previous = existingIndex === -1 ? undefined : supportingConnections[existingIndex];
        const next = {
          ...previous,
          ideaId: childIdeaId,
          relativePosition: previous?.relativePosition ?? [0, 0] as [number, number],
          weight: parent.weight ?? previous?.weight ?? 1,
          ...(parent.explanation !== undefined ? { explanation: parent.explanation } : {}),
        };
        if (existingIndex === -1) {
          supportingConnections.push(next);
        } else {
          supportingConnections[existingIndex] = next;
        }
        await trpcClient.idea.update.mutate({
          projectPath: args.projectPath as string,
          ideaId: parent.parentIdeaId,
          idea: { supportingConnections },
        });
      }

      // Verification gate (soft): closing an idea should mean verified-done,
      // not claimed-done. When status is set to implemented without any reflection
      // recording evidence, nudge the agent to addReflection. Non-blocking
      // and best-effort — never fails the update.
      let verificationNudge = "";
      if ((args.status as { state?: string } | undefined)?.state === "implemented") {
        try {
          const idea = await trpcClient.idea.get.query({
            projectPath: args.projectPath as string,
            ideaId: args.ideaId as string,
          });
          const hasReflection =
            (typeof idea?.reflection === "string" && idea.reflection.trim().length > 0) ||
            (Array.isArray(idea?.reflections) && idea.reflections.length > 0);
          if (!hasReflection) {
            verificationNudge =
              "\n\nReminder: marked implemented without a reflection. Record the verification evidence in update_idea.reflection or addReflection — " +
              verificationHintForIdea(idea) +
              " — so the graph reflects verified-done rather than claimed-done.";
          }
        } catch {
          // best-effort: a failed lookup must not break the update
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Updated idea ${args.ideaId}${verificationNudge}`,
          },
        ],
      };
    },
  },
  {
    name: "delete_idea",
    description: "Delete idea. Prefer status=cancelled unless duplicate/error.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string" }
      },
      required: ["projectPath", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      await trpcClient.idea.delete.mutate({
        projectPath: args.projectPath as string,
        ideaId: args.ideaId as string,
      });
      return {
        content: [
          {
            type: "text",
            text: `Deleted idea ${args.ideaId}`,
          },
        ],
      };
    },
  },
  {
    name: "addReflection",
    description: "Append a structured reflection (context, outcome, effectiveness, lesson) without changing idea status. For a simple free-text note, use update_idea.reflection.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string" },
        reflection: {
          type: "object",
          properties: {
            context: { type: "string" },
            outcome: { type: "string" },
            effectiveness: { type: "string" },
            lesson: { type: "string" },
            pattern: { type: "string" }
          },
          required: ["context", "outcome", "effectiveness", "lesson"]
        }
      },
      required: ["projectPath", "ideaId", "reflection"],
    },
    handler: async (args, trpcClient) => {
      await trpcClient.idea.addReflection.mutate({
        projectPath: args.projectPath as string,
        ideaId: args.ideaId as string,
        reflection: args.reflection as BackendInputs["idea"]["addReflection"]["reflection"],
      });
      return {
        content: [
          {
            type: "text",
            text: `Added reflection to idea ${args.ideaId}`,
          },
        ],
      };
    },
  },
  {
    name: "merge_ideas",
    description: "Merge source idea B into target idea A: rewires B's parents, children, and phase commitments onto A (deduplicating), copies B's reflections to A, then archives B. Use after finding duplicates via search_ideas_semantic, or to collapse a redundant child into its parent. Guards against self-merge only; a direct parent-child pair is merged cleanly (the connecting edge is dropped).",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        targetId: { type: "string", description: "UUID of the idea to keep (A)" },
        sourceId: { type: "string", description: "UUID of the idea to archive (B)" },
      },
      required: ["projectPath", "targetId", "sourceId"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.idea.merge.mutate({
        projectPath: args.projectPath as string,
        targetId: args.targetId as string,
        sourceId: args.sourceId as string,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
];
