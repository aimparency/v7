import { calculateIdeaValues, childBrief, defaultIdeaCost, INITIAL_STATES, MAX_SEARCH_QUERY_CHARS, missionPathsToRoot } from "shared";
import { IDEA_STATES_DESCRIPTION, SPACE_TOOL_PROPERTY } from "../constants.js";
import type { BackendClient, BackendInputs } from "../client.js";
import type { ToolDefinition } from "./types.js";
import { formatIdea, formatIdeas, describeRepoEdges } from "./format.js";
import { connectionInputSchema, normalizeConnectionInput, setsShares, toStoredConnection, type ConnectionInput } from "./connections.js";
import { applyShares, describeSplits, SHARE_GUIDE, shareUpdate, splitsSection, validatePercent, type ShareRequest } from "./shares.js";
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

type Connection = Exclude<ConnectionInput, string>;
type IdeaRecord = Awaited<ReturnType<BackendClient["idea"]["get"]["query"]>>;

// A parent edge's shares in percent: the child's own plus its siblings'.
function parentShareRequest(parent: Connection, childId: string): ShareRequest | undefined {
  if (!setsShares(parent)) return undefined;
  const shares = new Map(Object.entries(parent.siblingShares ?? {}));
  if (parent.share !== undefined) shares.set(childId, parent.share);
  return { shares, loopShare: parent.loopShare };
}

// The shares an idea sets on its own children, and the loop share it keeps.
function childShareRequest(children: Connection[], loopShare: unknown): ShareRequest | undefined {
  const shares = new Map(children.filter((child) => child.share !== undefined).map((child) => [child.ideaId, child.share!]));
  if (shares.size === 0 && loopShare === undefined) return undefined;
  return { shares, loopShare: loopShare === undefined ? undefined : validatePercent(loopShare, "loopShare", true) };
}

// The parent as it is about to be, with the child linked if it is not yet.
function withChild(parent: IdeaRecord, childId: string): IdeaRecord {
  return parent.supportingConnections.some((conn) => conn.ideaId === childId)
    ? parent
    : { ...parent, supportingConnections: [...parent.supportingConnections, { ideaId: childId, weight: 1, relativePosition: [0, 0] }] };
}

async function setShares(trpcClient: BackendClient, space: string, ideaId: string, request: ShareRequest) {
  const idea = await trpcClient.idea.get.query({ space, ideaId });
  await trpcClient.idea.update.mutate({ space, ideaId, idea: shareUpdate(idea, request) });
}

/**
 * Entering a status configured with promptsReflection settles the idea: ask to
 * reflect on each parent connection's hypothesis that has no reflection yet.
 */
async function reflectionNudgeFor(trpcClient: BackendClient, projectPath: string, ideaId: string, state: string): Promise<string> {
  const meta = await trpcClient.project.getMeta.query({ space: projectPath }).catch(() => null);
  const statuses = meta?.statuses ?? INITIAL_STATES;
  if (!statuses.find((status) => status.key === state)?.promptsReflection) return "";

  const idea = await trpcClient.idea.get.query({ space: projectPath, ideaId });
  const lines: string[] = [];
  for (const parentId of idea?.supportedIdeas ?? []) {
    const parent = await trpcClient.idea.get.query({ space: projectPath, ideaId: parentId }).catch(() => null);
    const connection = parent?.supportingConnections?.find((c) => c.ideaId === ideaId);
    if (!parent || !connection || connection.reflection?.trim()) continue;
    const hypothesis = connection.hypothesis?.trim() ? ` — hypothesis: "${connection.hypothesis.trim()}"` : " — no hypothesis recorded";
    lines.push(`- ${parent.text} (${parentId})${hypothesis}`);
  }
  if (lines.length === 0) return "";
  return `\n\n'${state}' settles this idea: reflect on each parent's hypothesis (did it hold?), via update_idea addSupportedIdeas: [{ ideaId: <parent>, reflection: "..." }]:\n${lines.join("\n")}`;
}

// The review is about what the idea is, so the token binds only its text:
// description, status, parents or estimates may still change before creating.
export function ideaCreationConfirmationToken(args: Record<string, unknown>): string {
  const text = String(args.text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256")
    .update(JSON.stringify([args.space, text]))
    .digest("hex")
    .slice(0, 24);
}

// What get_idea_context returns; get_prioritized_ideas includes it for its top idea.
// `allIdeas` saves loading the space again when the caller already has it.
export async function ideaContext(trpcClient: BackendClient, projectPath: string, ideaId: string, allIdeas?: Awaited<ReturnType<BackendClient["idea"]["list"]["query"]>>) {
  // The whole space powers the value model (to choose which parent to follow
  // at branches) and resolves parent/child text from a map instead of N round-trips.
  allIdeas ??= await trpcClient.idea.list.query({ space: projectPath });
  const ideaMap = new Map(allIdeas.map((a) => [a.id, a]));
  const { flowValues } = calculateIdeaValues(allIdeas);

  const idea = ideaMap.get(ideaId) || await trpcClient.idea.get.query({ space: projectPath, ideaId });

  const similarIdeas = await trpcClient.idea.searchSemantic.query({
    space: projectPath,
    // Text and the start of the description: a long description would exceed the search limit.
    query: `${idea.text} ${idea.description || ''}`.trim().slice(0, MAX_SEARCH_QUERY_CHARS),
    limit: 6 // Request 6, filter self
  });
  const semanticContext = similarIdeas
    .filter((a) => a.id !== ideaId)
    .slice(0, 5)
    .map((a) => ({ id: a.id, text: a.text, description: a.description }));

  // Immediate parents (an idea may have several) and children
  const parentContext = (idea.supportedIdeas || [])
    .flatMap((id) => ideaMap.get(id) ?? [])
    .map((p) => ({ id: p.id, text: p.text, description: p.description }));
  const childContext = (idea.supportingConnections || [])
    .flatMap((c) => ideaMap.get(c.ideaId) ?? [])
    .map(childBrief);

  // Black-box repo supporters: whole external repos carrying part of this
  // idea. They are not in ideaMap (nothing inside them is loaded, by design),
  // so they would be invisible without this.
  const repoCarrier = { supportingRepos: [...(idea.supportingRepos || [])] };
  await describeRepoEdges(trpcClient, projectPath, [repoCarrier]);

  const { pathToRoot, pathsToRoot, truncated } = missionPathsToRoot(ideaMap, idea, flowValues);
  return {
    idea: { id: idea.id, text: idea.text, description: idea.description },
    path_to_root: pathToRoot,
    paths_to_root: pathsToRoot,
    paths_to_root_truncated: truncated,
    semantic_context: semanticContext,
    parents: parentContext,
    children: childContext,
    supporting_repos: repoCarrier.supportingRepos
  };
}

export const ideaTools: ToolDefinition[] = [
  {
    name: "get_idea",
    description: "Get one idea's raw fields by ID. To orient before working on it, prefer get_idea_context.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        ideaId: { type: "string" }
      },
      required: ["space", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      const idea = await trpcClient.idea.get.query({
        space: args.space as string,
        ideaId: args.ideaId as string,
      });
      await describeRepoEdges(trpcClient, args.space as string, [idea]);
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
    description: "Orient before acting: returns the idea, the 10 strongest root-first mission paths (paths_to_root, ids and titles), the highest-value path with descriptions (path_to_root), related ideas, immediate parents, and children (open ones in full, settled ones as id, title and state). Cyclic/non-root branches are excluded and truncation is reported.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        ideaId: { type: "string" }
      },
      required: ["space", "ideaId"],
    },
    handler: async (args, trpcClient) => ({
      content: [{
        type: "text",
        text: JSON.stringify(await ideaContext(trpcClient, args.space as string, args.ideaId as string), null, 2),
      }],
    }),
  },
  {
    name: "search_ideas",
    description: "Search ideas by text/status. Empty query = most recently updated. Search before creating a new idea to avoid duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        query: { type: "string" },
        status: { type: ["string", "array"], items: { type: "string" } },
        phaseId: { type: "string" },
        archived: { type: "boolean" },
        limit: { type: "number" },
        offset: { type: "number" }
      },
      required: ["space", "query"],
    },
    handler: async (args, trpcClient) => {
      const ideas = await trpcClient.idea.search.query({
        space: args.space as string,
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
        space: SPACE_TOOL_PROPERTY,
        query: { type: "string" },
        status: { type: ["string", "array"], items: { type: "string" } },
        phaseId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["space", "query"],
    },
    handler: async (args, trpcClient) => {
      const results = await trpcClient.idea.searchSemantic.query({
        space: args.space as string,
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
    description: "Two-step creation: first call returns related active/cancelled ideas and a confirmationToken without writing. Review that context, then repeat the call with confirmationToken to create; the token binds the idea text, so other fields may change in between. Similarity informs judgment; it does not forbid a genuinely distinct idea. Connect the idea to the mission it serves, and estimate its cost.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        text: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        status: {
          type: "object",
          properties: {
            state: { type: "string", description: IDEA_STATES_DESCRIPTION },
            comment: { type: "string", description: "Why the idea is in this state: evidence, blocker, or open question." },
            reviewedAt: { type: "number", description: "Timestamp confirming status and intention still hold (keeps the transition date)." },
          },
        },
        supportingConnections: connectionInputSchema("Child ideas: UUIDs or { ideaId, share, hypothesis }."),
        supportedIdeas: connectionInputSchema("Parent ideas this one serves: UUIDs or { ideaId, share, siblingShares, loopShare, hypothesis } for the parent→new-idea edge. The review call shows each parent's current split in percent.", true),
        loopShare: { type: "number", description: "Percent of its value this idea keeps for its own work, next to the shares of its children" },
        intrinsicValue: { type: "number", minimum: 0, description: "Standalone estimated value; includes expected partial completion or failure" },
        valueRationale: { type: "string", description: "Human-authored rationale for the standalone estimated value; never auto-derived" },
        cost: { type: "number", exclusiveMinimum: 0, description: "Positive estimated direct present cost in the project's cost unit, compared against the related ideas' costs from the review call. Optional but expected: without it the idea is ranked at the project's default cost and space_hygiene lists it as unestimated" },
        duration: { type: "number", minimum: 0, description: "Estimated days from now until the idea's value is realized" },
        phaseId: { type: "string" },
        confirmationToken: { type: "string", description: "Token returned by the review-only first call. Changing the text requires a fresh review; other fields may change." },
      },
      required: ["space", "text"],
    },
    handler: async (args, trpcClient) => {
      if (args.cost !== undefined && (!Number.isFinite(args.cost) || (args.cost as number) <= 0)) {
        throw new Error("Estimated direct cost must be a finite number greater than 0.");
      }
      if (args.duration !== undefined && (!Number.isFinite(args.duration) || (args.duration as number) < 0)) {
        throw new Error("Duration must be a finite number greater than or equal to 0 days.");
      }
      const parents = ((args.supportedIdeas as ConnectionInput[] | undefined) ?? []).map(normalizeConnectionInput);
      const children = ((args.supportingConnections as ConnectionInput[] | undefined) ?? []).map(normalizeConnectionInput);
      const ownShares = childShareRequest(children, args.loopShare);
      const expectedToken = ideaCreationConfirmationToken(args);
      if (args.confirmationToken === undefined) {
        const [related, projectMeta, parentSplits] = await Promise.all([
          trpcClient.idea.search.query({
            space: args.space as string,
            query: args.text as string,
            limit: 8,
          }),
          trpcClient.project.getMeta.query({ space: args.space as string }).catch(() => null),
          describeSplits(trpcClient, args.space as string, parents.map((parent) => parent.ideaId)),
        ]);
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
                "repeat the create_idea call with confirmationToken (same text; other fields may change).",
              costEstimate: args.cost === undefined
                ? `No cost given. Estimate the idea's direct cost in ${projectMeta?.costUnit || "the project's abstract cost units"} ` +
                  "(its own work, not its children's) relative to the related ideas' costs, and pass it as cost. " +
                  `Without it the idea is ranked at the default cost ${defaultIdeaCost(projectMeta)} and space_hygiene lists it as unestimated.`
                : undefined,
              parentSplits: parentSplits
                ? `${parentSplits}\n\nHow much of each parent does the new idea carry next to these? Pass share on its supportedIdeas entry. ${SHARE_GUIDE}`
                : undefined,
              relatedIdeas: related.map((idea) => ({
                id: idea.id,
                text: idea.text,
                description: idea.description,
                status: idea.status,
                cost: idea.cost,
                score: idea.score,
              })),
            }, null, 2),
          }],
        };
      }
      if (args.confirmationToken !== expectedToken) {
        throw new Error(
          "confirmationToken does not match this idea text. " +
          "Call create_idea again without confirmationToken to review context for the edited text.",
        );
      }

      // Check every share before writing anything, against a stand-in for the new idea.
      const pendingId = "the new idea";
      const parentRequests = parents.map((parent) => parentShareRequest(parent, pendingId));
      const parentIdeas = parentRequests.some(Boolean)
        ? await trpcClient.idea.getMany.query({ space: args.space as string, ideaIds: parents.map((parent) => parent.ideaId) })
        : [];
      parents.forEach((parent, index) => {
        const request = parentRequests[index];
        const parentIdea = parentIdeas.find((idea) => idea.id === parent.ideaId);
        if (request && !parentIdea) throw new Error(`Parent idea ${parent.ideaId} not found.`);
        if (request) applyShares(withChild(parentIdea!, pendingId), request);
      });
      if (ownShares) {
        applyShares({
          id: pendingId,
          selfWeight: 1,
          supportingConnections: children.map((child) => ({ ideaId: child.ideaId, weight: child.weight ?? 1, relativePosition: [0, 0] })),
        }, ownShares);
      }

      const result = await trpcClient.idea.createFloatingIdea.mutate({
        space: args.space as string,
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
        inheritColorFrom: parents[0]?.ideaId,
      });

      // Handle supportingConnections (children)
      for (const child of children) {
        await trpcClient.idea.connectIdeas.mutate({
          space: args.space as string,
          parentIdeaId: result.id,
          childIdeaId: child.ideaId,
          weight: child.weight,
          hypothesis: child.hypothesis,
        });
      }

      // Handle supportedIdeas (parents)
      for (const parent of parents) {
        await trpcClient.idea.connectIdeas.mutate({
          space: args.space as string,
          parentIdeaId: parent.ideaId,
          childIdeaId: result.id,
          weight: parent.weight,
          hypothesis: parent.hypothesis,
        });
        const request = parentShareRequest(parent, result.id);
        if (request) await setShares(trpcClient, args.space as string, parent.ideaId, request);
      }
      if (ownShares) await setShares(trpcClient, args.space as string, result.id, ownShares);

      // If phaseId provided, commit to phase
      if (args.phaseId) {
        await trpcClient.idea.commitToPhase.mutate({
          space: args.space as string,
          ideaId: result.id,
          phaseId: args.phaseId as string,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Created idea with ID: ${result.id}${args.phaseId ? ` and committed to phase ${args.phaseId}` : ''}` +
              (args.cost === undefined ? ". It has no cost estimate yet: set one via update_idea." : "") +
              splitsSection(await describeSplits(
                trpcClient,
                args.space as string,
                [...parents.map((parent) => parent.ideaId), ...(ownShares ? [result.id] : [])],
                result.id,
              )),
          },
        ],
      };
    },
  },
  {
    name: "update_idea",
    description: "Update idea fields; only the given ones change. Links change through add*/remove*. status.comment is the idea's one note: with status=implemented it records the verification evidence (verified-done, not claimed-done). When blocked set unclear/human-dependent with the question in the comment. Reflect on a hypothesis on the connection: addSupportedIdeas [{ ideaId: <parent>, reflection }].",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        ideaId: { type: "string" },
        text: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        status: {
          type: "object",
          properties: {
            state: { type: "string", description: IDEA_STATES_DESCRIPTION },
            comment: { type: "string", description: "Why the idea is in this state: evidence, blocker, or open question." },
            reviewedAt: { type: "number", description: "Timestamp confirming status and intention still hold (keeps the transition date)." },
          },
        },
        addSupportingConnections: connectionInputSchema("Add child links, or update share/hypothesis/reflection of existing ones."),
        removeSupportingConnections: { type: "array", items: { type: "string" }, description: "Child idea UUIDs to unlink." },
        addSupportedIdeas: connectionInputSchema("Add parent links, or update share/hypothesis/reflection of the parent→this-idea edge (reflect on the hypothesis once this idea is settled). The reply shows each parent's split in percent.", true),
        removeSupportedIdeas: { type: "array", items: { type: "string" }, description: "Parent idea UUIDs to unlink." },
        intrinsicValue: { type: "number", minimum: 0, description: "Standalone estimated value; includes expected partial completion or failure" },
        valueRationale: { type: "string", description: "Human-authored rationale for the standalone estimated value; never auto-derived" },
        cost: { type: "number", exclusiveMinimum: 0, description: "Positive estimated direct present cost in the project's cost unit (see get_prioritized_ideas economics)" },
        duration: { type: "number", minimum: 0, description: "Estimated days from now until the idea's value is realized" },
        loopShare: { type: "number", description: "Percent of its value this idea keeps for its own work, next to the shares of its children" },
      },
      required: ["space", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      // The backend validates these; the tool schema above already names them.
      const fields = args as BackendInputs["idea"]["update"]["idea"];
      const updateData: BackendInputs["idea"]["update"]["idea"] = {};
      if (fields.text) updateData.text = fields.text;
      if (fields.description !== undefined) updateData.description = fields.description;
      if (fields.tags) updateData.tags = fields.tags;
      if (fields.status) updateData.status = fields.status;
      if (fields.intrinsicValue !== undefined) updateData.intrinsicValue = fields.intrinsicValue;
      if (fields.valueRationale !== undefined) updateData.valueRationale = fields.valueRationale;
      if (fields.cost !== undefined) updateData.cost = fields.cost;
      if (fields.duration !== undefined) updateData.duration = fields.duration;

      const space = args.space as string;
      const ideaId = args.ideaId as string;
      const addedChildren = ((args.addSupportingConnections as ConnectionInput[] | undefined) ?? []).map(normalizeConnectionInput);
      const addedParents = ((args.addSupportedIdeas as ConnectionInput[] | undefined) ?? []).map(normalizeConnectionInput);
      const ownShares = childShareRequest(addedChildren, args.loopShare);
      const parentMetadataToApply: Array<{ parentIdeaId: string; weight?: number; hypothesis?: string; reflection?: string; shares?: ShareRequest }> = [];

      // Check every parent's shares before writing anything.
      const parentRequests = addedParents.map((parent) => parentShareRequest(parent, ideaId));
      if (parentRequests.some(Boolean)) {
        const parentIdeas = await trpcClient.idea.getMany.query({ space, ideaIds: addedParents.map((parent) => parent.ideaId) });
        addedParents.forEach((parent, index) => {
          const request = parentRequests[index];
          const parentIdea = parentIdeas.find((idea) => idea.id === parent.ideaId);
          if (request && !parentIdea) throw new Error(`Parent idea ${parent.ideaId} not found.`);
          if (request) applyShares(withChild(parentIdea!, ideaId), request);
        });
      }

      if (args.addSupportingConnections !== undefined || args.removeSupportingConnections !== undefined ||
          args.addSupportedIdeas !== undefined || args.removeSupportedIdeas !== undefined || ownShares) {
        const existingIdea = await trpcClient.idea.get.query({
          space: args.space as string,
          ideaId: args.ideaId as string,
        });

        if (args.addSupportingConnections !== undefined || args.removeSupportingConnections !== undefined || ownShares) {
          const byChildId = new Map<string, IdeaRecord["supportingConnections"][number]>();
          for (const conn of existingIdea.supportingConnections ?? []) {
            byChildId.set(conn.ideaId, { ...conn });
          }
          for (const childId of (args.removeSupportingConnections as string[] | undefined) ?? []) {
            byChildId.delete(childId);
          }
          for (const input of addedChildren) {
            const next = toStoredConnection(input);
            byChildId.set(next.ideaId, { weight: 1, relativePosition: [0, 0], ...byChildId.get(next.ideaId), ...next });
          }
          const supportingConnections = Array.from(byChildId.values());
          updateData.supportingConnections = supportingConnections;
          if (ownShares) Object.assign(updateData, shareUpdate({ ...existingIdea, supportingConnections }, ownShares));
        }

        if (args.addSupportedIdeas !== undefined || args.removeSupportedIdeas !== undefined) {
          const parentIds = new Set<string>(existingIdea.supportedIdeas ?? []);
          for (const parentId of (args.removeSupportedIdeas as string[] | undefined) ?? []) {
            parentIds.delete(parentId);
          }
          addedParents.forEach((parent, index) => {
            parentIds.add(parent.ideaId);
            parentMetadataToApply.push({ parentIdeaId: parent.ideaId, weight: parent.weight, hypothesis: parent.hypothesis, reflection: parent.reflection, shares: parentRequests[index] });
          });
          updateData.supportedIdeas = Array.from(parentIds);
        }
      }

      await trpcClient.idea.update.mutate({
        space: args.space as string,
        ideaId: args.ideaId as string,
        idea: updateData,
      });

      for (const parent of parentMetadataToApply) {
        if (parent.weight === undefined && parent.hypothesis === undefined && parent.reflection === undefined && !parent.shares) continue;

        const parentIdea = await trpcClient.idea.get.query({
          space: args.space as string,
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
          ...(parent.hypothesis !== undefined ? { hypothesis: parent.hypothesis } : {}),
          ...(parent.reflection !== undefined ? { reflection: parent.reflection } : {}),
        };
        if (existingIndex === -1) {
          supportingConnections.push(next);
        } else {
          supportingConnections[existingIndex] = next;
        }
        await trpcClient.idea.update.mutate({
          space,
          ideaId: parent.parentIdeaId,
          idea: parent.shares ? shareUpdate({ ...parentIdea, supportingConnections }, parent.shares) : { supportingConnections },
        });
      }

      // Verification gate (soft): closing an idea should mean verified-done,
      // not claimed-done. When status is set to implemented with an empty status
      // comment, nudge the agent to record the evidence there. Non-blocking
      // and best-effort — never fails the update.
      let verificationNudge = "";
      if ((args.status as { state?: string } | undefined)?.state === "implemented") {
        try {
          const idea = await trpcClient.idea.get.query({
            space: args.space as string,
            ideaId: args.ideaId as string,
          });
          if (!idea?.status?.comment?.trim()) {
            verificationNudge =
              "\n\nReminder: marked implemented without evidence. Record it in status.comment — " +
              verificationHintForIdea(idea) +
              " — so the space reflects verified-done rather than claimed-done.";
          }
        } catch {
          // best-effort: a failed lookup must not break the update
        }
      }

      const newState = (args.status as { state?: string } | undefined)?.state;
      const reflectionNudge = newState
        ? await reflectionNudgeFor(trpcClient, args.space as string, args.ideaId as string, newState).catch(() => "")
        : "";

      return {
        content: [
          {
            type: "text",
            text: `Updated idea ${args.ideaId}${verificationNudge}${reflectionNudge}` +
              splitsSection(await describeSplits(
                trpcClient,
                space,
                [...addedParents.map((parent) => parent.ideaId), ...(ownShares || addedChildren.length ? [ideaId] : [])],
                ideaId,
              )),
          },
        ],
      };
    },
  },
  {
    name: "delete_idea",
    description: "Delete idea. Prefer status=cancelled unless duplicate/error. cascade=true also deletes descendants that no other parent or phase anchors.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        ideaId: { type: "string" },
        cascade: { type: "boolean" }
      },
      required: ["space", "ideaId"],
    },
    handler: async (args, trpcClient) => {
      const { deletedIds } = await trpcClient.idea.delete.mutate({
        space: args.space as string,
        ideaIds: [args.ideaId as string],
        cascade: args.cascade === true,
      });
      return {
        content: [
          {
            type: "text",
            text: `Deleted ${deletedIds.length} idea(s): ${deletedIds.join(", ")}`,
          },
        ],
      };
    },
  },
  {
    name: "merge_ideas",
    description: "Merge source idea B into target idea A: rewires B's parents, children, and phase commitments onto A (deduplicating), appends B's status comment to A's, then archives B. Use after finding duplicates via search_ideas_semantic, or to collapse a redundant child into its parent. Guards against self-merge only; a direct parent-child pair is merged cleanly (the connecting edge is dropped).",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        targetId: { type: "string", description: "UUID of the idea to keep (A)" },
        sourceId: { type: "string", description: "UUID of the idea to archive (B)" },
      },
      required: ["space", "targetId", "sourceId"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.idea.merge.mutate({
        space: args.space as string,
        targetId: args.targetId as string,
        sourceId: args.sourceId as string,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
];

// Several update_idea calls in one: the end of a work chunk usually settles a
// few ideas at once (status, links).
const updateIdea = ideaTools.find((tool) => tool.name === "update_idea")!;
const { space: _space, ...updateFields } = (updateIdea.inputSchema.properties ?? {}) as Record<string, object>;
ideaTools.push({
  name: "update_ideas",
  description: "Batch of update_idea calls (same fields per entry), applied in order. Stops at the first failure and reports which updates were applied.",
  inputSchema: {
    type: "object",
    properties: {
      space: SPACE_TOOL_PROPERTY,
      updates: { type: "array", items: { type: "object", properties: updateFields, required: ["ideaId"] } },
    },
    required: ["space", "updates"],
  },
  handler: async (args, trpcClient) => {
    const applied: string[] = [];
    for (const update of (args.updates as Record<string, unknown>[]) ?? []) {
      try {
        const result = await updateIdea.handler({ ...update, space: args.space }, trpcClient);
        const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
        if (result.isError) throw new Error(text);
        applied.push(text);
      } catch (error) {
        const failure = `Failed on ${update.ideaId}: ${error instanceof Error ? error.message : String(error)}`;
        return { isError: true, content: [{ type: "text", text: [...applied, failure].join("\n\n") }] };
      }
    }
    return { content: [{ type: "text", text: applied.join("\n\n") }] };
  },
});
