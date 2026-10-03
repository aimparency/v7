import { calculateIdeaValues, defaultIdeaCost } from "shared";
import { PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import { countIdeaReferences } from "../reconcile.js";
import type { ToolDefinition } from "./types.js";
import { formatIdea } from "./format.js";
import { getRepoCommitMessages } from "./git.js";

export const navigationTools: ToolDefinition[] = [
  {
    name: "get_prioritized_ideas",
    description: "Start and resume the infinite loop here. Operate through the graph first: pick a high-value actionable idea, update ideas/connections/phases as understanding changes, verify real outcomes, record the result on the idea, then return and reprioritize toward the mission. Do not substitute planning Markdown for graph state. Ranks phase-committed open ideas; if the phase contains only open containers, ranks connected uncommitted open leaves instead (an equal path — work reaches you through parents as well as phases). If no actionable leaf exists anywhere, returns an explicit exploration contract: step back, inspect hygiene/reflections, decompose a mission, or create a bounded hypothesis and experiment in graph state.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        phaseId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      // Fetch all phases once; we need them for both explicit lookup and time-based resolution.
      // parentPhaseId omitted → backend returns all phases
      const allPhases: any[] = await trpcClient.phase.list.query({
        projectPath: args.projectPath as string,
      });
      const phaseById = new Map<string, any>(allPhases.map((p: any) => [p.id, p]));
      // Reported once here instead of in every tool description: what cost estimates mean in this project.
      const projectMeta: any = await trpcClient.project.getMeta.query({ projectPath: args.projectPath as string }).catch(() => null);

      let targetPhase: any = null;

      if (args.phaseId) {
        targetPhase = phaseById.get(args.phaseId as string) ?? null;
      }

      if (!targetPhase) {
        // Time-based resolution: find the deepest currently-active leaf phase
        // that has open commitments. "phaseCursors" in meta.json can be stale
        // or store indices rather than UUIDs, so we don't rely on it.
        const now = Date.now();
        const activePhases = allPhases.filter(
          (p: any) => p.from > 0 && p.to > 0 && p.from <= now && now <= p.to
        );

        // Build a helper: is this phase a leaf (no children, or all children are inactive)?
        const hasActiveChild = (phase: any): boolean =>
          (phase.childPhaseIds ?? []).some((cid: string) => {
            const child = phaseById.get(cid);
            return child && child.from > 0 && child.to > 0 && child.from <= now && now <= child.to;
          });

        // Prefer deepest active leaf with open commitments; fall back up the tree.
        const leaves = activePhases.filter((p: any) => !hasActiveChild(p));
        const candidates = leaves.length > 0 ? leaves : activePhases;

        // Walk up from each candidate until we find one with commitments.
        const findWithCommitments = (phase: any): any => {
          if (!phase) return null;
          if ((phase.commitments ?? []).length > 0) return phase;
          const parent = phaseById.get(phase.parent);
          return findWithCommitments(parent);
        };

        for (const leaf of candidates) {
          const found = findWithCommitments(leaf);
          if (found) { targetPhase = found; break; }
        }
      }

      if (!targetPhase) {
        return { content: [{ type: "text", text: "No active phase found. Use list_phases to find a phase and pass phaseId." }] };
      }

      // Run the full-graph economic model so value flows top-down from
      // high-value goals (e.g. ASI) into the sub-ideas that support them and
      // cost aggregates bottom-up. Ranking a single idea by its own
      // intrinsicValue/cost ignores the graph and is near-useless when most
      // intrinsic value sits at the top.
      const allIdeas = await trpcClient.idea.list.query({
        projectPath: args.projectPath as string,
      });
      const { priorities, values, costs, totalIntrinsic } = calculateIdeaValues(allIdeas as any);

      const ideaIdSet = new Set<string>(targetPhase.commitments ?? []);
      const openInPhase = (allIdeas as any[]).filter(
        (a: any) => ideaIdSet.has(a.id) && a.status.state === 'open'
      );
      const hasActiveChild = (idea: any) => (idea.supportingConnections ?? []).some((connection: any) => {
        const child = (allIdeas as any[]).find((candidate: any) => candidate.id === connection.ideaId);
        return child && ['open', 'partially'].includes(child.status?.state);
      });
      const openLeavesInPhase = openInPhase.filter((idea: any) => !hasActiveChild(idea));
      const uncommittedLeaves = openLeavesInPhase.length === 0
        ? (allIdeas as any[]).filter((idea: any) =>
            idea.status?.state === 'open'
            && (idea.committedIn ?? []).length === 0
            && (idea.supportedIdeas ?? []).length > 0
            && !hasActiveChild(idea)
          )
        : [];
      const rankedOpenIdeas = uncommittedLeaves.length > 0
        ? uncommittedLeaves
        : openInPhase;
      const emptyActionableFrontier = openLeavesInPhase.length === 0 && uncommittedLeaves.length === 0;
      const selectionScope = uncommittedLeaves.length > 0
        ? 'connected-uncommitted-leaves'
        : emptyActionableFrontier
          ? 'mission-containers-exploration'
          : 'phase-commitments';

      // Diagnostics: how many committed ideas are missing economic data
      const allCommitted = (allIdeas as any[]).filter((a: any) => ideaIdSet.has(a.id));
      // An idea with effectively-zero flowed value is disconnected from any intrinsic
      // value source in the graph — its priority is meaningless regardless of cost.
      const missingValue = allCommitted.filter(
        (a: any) => (values.get(a.id) ?? 0) < 1e-10
      ).length;

      const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : (n > 0 ? "Infinity" : "-Infinity"));

      // Phase-level economic summary
      const phaseFlowedValue = allCommitted.reduce(
        (sum, a) => sum + (values.get(a.id) ?? 0) * totalIntrinsic, 0
      );
      const phaseTotalCost = allCommitted.reduce(
        (sum, a) => sum + (costs.get(a.id) ?? 0), 0
      );
      const phaseValueFraction = totalIntrinsic > 0
        ? phaseFlowedValue / totalIntrinsic
        : 0;

      // Realized-cost signal: real commits referencing each open idea = actual
      // output. Grounds attention in reality (which ranked ideas have actually
      // produced work) without mutating the human-set value model.
      const commitMessages = getRepoCommitMessages(args.projectPath as string);
      const realized = countIdeaReferences(commitMessages, rankedOpenIdeas.map((a: any) => a.id));
      const realizedSignalAvailable = commitMessages.length > 0;
      // High-priority ideas with a real cost but zero realized output are the
      // ones the loop keeps ranking yet never actually advances — surface them.
      const noRealizedOutput = realizedSignalAvailable
        ? rankedOpenIdeas.filter((a: any) => (a.cost ?? 0) > 0 && !(realized.get(a.id) ?? 0)).length
        : 0;

      const prioritized = rankedOpenIdeas
        .map((a: any) => ({
          ...a,
          _priority: priorities.get(a.id) ?? 0,
          _flowedValue: (values.get(a.id) ?? 0) * totalIntrinsic,
          _aggregatedCost: costs.get(a.id) ?? 0,
          _realizedCommits: realized.get(a.id) ?? 0,
        }))
        .sort((a: any, b: any) => b._priority - a._priority)
        .slice(0, (args.limit as number) || 10);

      // Build phase path for context
      const phasePath: string[] = [];
      let cur: any = targetPhase;
      while (cur) {
        phasePath.unshift(cur.name);
        cur = phaseById.get(cur.parent);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              phasePath,
              phase: targetPhase.name,
              selectionScope,
              model: "flow-based (top-down estimated value, bottom-up estimated cost, discounted value/cost profitability ratio)",
              economics: {
                costUnit: projectMeta?.costUnit || "abstract units",
                defaultCost: defaultIdeaCost(projectMeta),
                phaseFlowedValue: fmt(phaseFlowedValue),
                phaseTotalCost: fmt(phaseTotalCost),
                phaseValueFraction: (phaseValueFraction * 100).toFixed(1) + "%",
                totalGraphIntrinsicValue: totalIntrinsic,
              },
              diagnostics: {
                committedIdeas: allCommitted.length,
                openIdeas: openInPhase.length,
                openLeafIdeas: openLeavesInPhase.length,
                uncommittedLeafIdeas: uncommittedLeaves.length,
                disconnectedFromValue: missingValue,
                realizedSignal: realizedSignalAvailable ? "git-commit-references" : "unavailable (not a git repo / no commits)",
                openIdeasWithNoRealizedOutput: realizedSignalAvailable ? noRealizedOutput : undefined,
                note: uncommittedLeaves.length > 0
                  ? `No open leaf idea is committed to this phase; ranked ${uncommittedLeaves.length} connected uncommitted open leaf idea(s) instead. They are reachable through their parents — rank and work them as they are; committing them to a phase is optional.`
                  : emptyActionableFrontier
                  ? "No open actionable leaf exists in the phase or connected uncommitted graph. Mission containers are context for exploration, not executable work."
                  : missingValue > 0
                  ? `${missingValue} idea(s) have zero flowed value — they are disconnected from any intrinsic value source in the graph. Their priorities are unreliable.`
                  : "All committed ideas have economic data.",
              },
              exploration: emptyActionableFrontier ? {
                required: true,
                objective: "Create or uncover the next valuable actionable leaf in Aimparency graph state before implementing.",
                moves: [
                  "Inspect graph_hygiene and recent reflections for structural or learned opportunities.",
                  "Step back from the most recent scope and decompose a high-value abstract non-done mission into a bounded leaf.",
                  "Dream up a falsifiable hypothesis with a safe reversible experiment, explicit verification, and stop condition.",
                  "Search before create_idea; connect genuinely new work to the mission and commit it to the active phase.",
                  "Do not manufacture low-value activity or substitute Markdown planning for graph state."
                ]
              } : undefined,
              ideas: prioritized.map((a: any) => ({
                id: a.id,
                text: a.text,
                description: a.description,
                priority: fmt(a._priority),
                flowedValue: fmt(a._flowedValue),
                aggregatedCost: fmt(a._aggregatedCost),
                realizedCommits: a._realizedCommits,
                intrinsicValue: a.intrinsicValue,
                rawCost: a.cost,
                status: a.status?.state,
              })),
            }, null, 2),
          },
        ],
      };
    },
  },
  {
    name: "get_active_path",
    description: "Get the active phase path from stored cursor state (root → deepest selected phase)",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.phase.getActivePath.query({
        projectPath: args.projectPath as string,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            path: result.path.map((p: any) => ({ id: p.id, name: p.name, parent: p.parent })),
            activeLevel: result.activeLevel,
            activePhase: result.activePhase ? { id: result.activePhase.id, name: result.activePhase.name } : null,
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "list_ideas",
    description: "List all ideas. Filter by status, phaseId, floating (no phase AND no parents — orphans to reparent), or uncommitted (not in any phase). An idea with a parent needs no phase: it already contributes through that parent, so uncommitted is a normal resting state, not a gap. Use uncommitted=true with status=open to browse that backlog; commit_idea_to_phase only what you intend to act on in the phase.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        status: { type: ["string", "array"], items: { type: "string" } },
        phaseId: { type: "string" },
        floating: { type: "boolean" },
        uncommitted: { type: "boolean" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const ideas = await trpcClient.idea.list.query({
        projectPath: args.projectPath as string,
        status: args.status as string | string[] | undefined,
        phaseId: args.phaseId as string | undefined,
        floating: args.floating as boolean | undefined,
        uncommitted: args.uncommitted as boolean | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(ideas.map(formatIdea), null, 2) }],
      };
    },
  },
  {
    name: "list_phase_ideas_recursive",
    description: "Open ideas under a phase as a nested tree (keeps parent path to open descendants). Pass status to override.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        phaseId: { type: "string" },
        status: { type: ["string", "array"], items: { type: "string" } }
      },
      required: ["projectPath", "phaseId"],
    },
    handler: async (args, trpcClient) => {
        // 1. Get all ideas (cache them)
        const allIdeas: any[] = await trpcClient.idea.list.query({
            projectPath: args.projectPath as string,
        });
        const ideaMap = new Map(allIdeas.map((a: any) => [a.id, a]));

        // 2. Fetch the target phase directly
        const phase = await trpcClient.phase.get.query({
            projectPath: args.projectPath as string,
            phaseId: args.phaseId as string,
        });

        const roots = phase.commitments;
        
        // 3. Traverse
        const visited = new Set<string>();
        const result: any[] = [];
        const allowedStatuses = args.status 
            ? (Array.isArray(args.status) ? args.status : [args.status])
            : ['open'];

        function buildTree(ideaId: string): any | null {
            if (visited.has(ideaId)) return null; // Cycle detection
            visited.add(ideaId);

            const idea = ideaMap.get(ideaId);
            if (!idea) return null;

            const children = (idea.supportingConnections || [])
                .map((conn: any) => buildTree(typeof conn === 'string' ? conn : conn.ideaId))
                .filter((c: any) => c !== null);

            const node = {
                id: idea.id,
                text: idea.text,
                description: idea.description,
                status: idea.status.state,
                children: children
            };

            const isOpen = (allowedStatuses as string[]).includes(idea.status.state);
            const hasOpenChildren = children.length > 0;

            // Keep if open OR has open children (so we can see the path to the open child)
            if (isOpen || hasOpenChildren) {
                return node;
            }
            return null;
        }

        for (const rootId of roots) {
            const tree = buildTree(rootId);
            if (tree) result.push(tree);
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }]
        };
    },
  },
];
