import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { calculateAimValues } from "shared";
import { trpc } from "./client.js";
import { AIM_STATES_DESCRIPTION, PROJECT_PATH_TOOL_PROPERTY } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

function formatAim(aim: any) {
  if (aim.supportingConnections) {
    if (aim.supportingConnections.length === 0) {
        delete aim.supportingConnections;
    } else {
        aim.supportingConnections = aim.supportingConnections.map((conn: any) => {
          const { relativePosition, ...rest } = conn;
          return rest;
        });
    }
  }
  if (aim.supportedAims && aim.supportedAims.length === 0) delete aim.supportedAims;
  if (aim.committedIn && aim.committedIn.length === 0) delete aim.committedIn;
  if (aim.tags && aim.tags.length === 0) delete aim.tags;
  
  return aim;
}

function formatAims(aims: any[]) {
  return aims.map(formatAim);
}

export function registerTools(server: Server, clientOverride?: any) {
  const trpcClient = clientOverride || trpc;
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_aim",
          description: "Get aim by ID",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" }
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "get_aim_context",
          description: "Get aim + 5 semantic neighbors + parents/children",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" }
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "search_aims",
          description: "Search aims by text/status. Empty query = most recently updated.",
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
        },
        {
          name: "list_phase_aims_recursive",
          description: "All aims recursively within a phase (default: open only)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" },
              status: { type: ["string", "array"], items: { type: "string" } }
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "list_phases",
          description: "List phases (ordered, no dates)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              parentPhaseId: { type: ["string", "null"] },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "search_phases",
          description: "Search phases by name",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              query: { type: "string" },
              parentPhaseId: { type: ["string", "null"] },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "create_aim",
          description: "Create aim. Use phaseId to commit in one step.",
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
                  state: { type: "string", description: AIM_STATES_DESCRIPTION },
                  comment: { type: "string" },
                },
              },
              supportingConnections: { type: "array", items: { type: "string" }, description: "child aim UUIDs" },
              supportedAims: { type: "array", items: { type: "string" }, description: "parent aim UUIDs" },
              phaseId: { type: "string" },
            },
            required: ["projectPath", "text"],
          },
        },
        {
          name: "update_aim",
          description: "Update aim text/status/relationships. Update before git commit.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" },
              text: { type: "string" },
              description: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              status: {
                type: "object",
                properties: {
                  state: { type: "string", description: AIM_STATES_DESCRIPTION },
                  comment: { type: "string" },
                },
              },
              supportingConnections: { type: "array", items: { type: "string" }, description: "child aim UUIDs" },
              supportedAims: { type: "array", items: { type: "string" }, description: "parent aim UUIDs" },
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "delete_aim",
          description: "Delete aim. Prefer status=cancelled unless duplicate/error.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" }
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "addReflection",
          description: "Add reflection to a completed aim",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" },
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
            required: ["projectPath", "aimId", "reflection"],
          },
        },
        {
          name: "create_phase",
          description: "Create phase (ordered, no dates)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              name: { type: "string" },
              parent: { type: ["string", "null"] },
            },
            required: ["projectPath", "name"],
          },
        },
        {
          name: "update_phase",
          description: "Update phase name/parent",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" },
              name: { type: "string" },
              parent: { type: ["string", "null"] },
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "delete_phase",
          description: "Delete phase (aims remain, just uncommitted)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" }
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "commit_aim_to_phase",
          description: "Commit aim to phase",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" },
              phaseId: { type: "string" },
              insertionIndex: { type: "number" },
            },
            required: ["projectPath", "aimId", "phaseId"],
          },
        },
        {
          name: "remove_aim_from_phase",
          description: "Remove aim from phase (aim not deleted)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string" },
              phaseId: { type: "string" },
            },
            required: ["projectPath", "aimId", "phaseId"],
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
        },
        {
          name: "get_prioritized_aims",
          description: "Get prioritized open aims from deepest active phase (or given phaseId)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string" },
              limit: { type: "number" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "list_aims",
          description: "List all aims. Optionally filter by status, phaseId, or floating (uncommitted, no parents).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              status: { type: ["string", "array"], items: { type: "string" } },
              phaseId: { type: "string" },
              floating: { type: "boolean" },
              limit: { type: "number" },
              offset: { type: "number" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "check_consistency",
          description: "Check the aim graph for structural issues: broken links, mismatched parent/child references, orphaned embeddings. Run before fix_consistency.",
          inputSchema: {
            type: "object",
            properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
            required: ["projectPath"],
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
        },
        {
          name: "build_search_index",
          description: "Rebuild the text search index and queue background embedding generation for semantic search.",
          inputSchema: {
            type: "object",
            properties: { projectPath: PROJECT_PATH_TOOL_PROPERTY },
            required: ["projectPath"],
          },
        },
        {
          name: "search_aims_semantic",
          description: "Search aims by semantic similarity (embedding-based). Requires build_search_index to have run. Useful for finding duplicates.",
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
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (!args) {
        throw new Error("Arguments are required for tool calls");
      }

      switch (name) {
        case "get_aim": {
          const aim = await trpcClient.aim.get.query({
            projectPath: args.projectPath as string,
            aimId: args.aimId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formatAim(aim), null, 2),
              },
            ],
          };
        }

        case "get_aim_context": {
          const aimId = args.aimId as string;
          const projectPath = args.projectPath as string;

          // 1. Get Target Aim
          const aim = await trpcClient.aim.get.query({ projectPath, aimId });
          
          // 2. Semantic Search
          const queryText = `${aim.text} ${aim.description || ''}`.trim();
          const similarAims = await trpcClient.aim.searchSemantic.query({
            projectPath,
            query: queryText,
            limit: 6 // Request 6, filter self
          });
          const semanticContext = similarAims
            .filter((a: any) => a.id !== aimId)
            .slice(0, 5)
            .map((a: any) => ({ id: a.id, text: a.text, description: a.description }));

          // 3. Parents
          const parentIds = aim.supportedAims || [];
          const parents = await Promise.all(parentIds.map((id: string) => 
             trpcClient.aim.get.query({ projectPath, aimId: id }).catch(() => null)
          ));
          const parentContext = parents
            .filter((p: any) => p !== null)
            .map((p: any) => ({ id: p.id, text: p.text, description: p.description }));

          // 4. Children
          const childConnections = aim.supportingConnections || [];
          const children = await Promise.all(childConnections.map((c: any) => 
             trpcClient.aim.get.query({ projectPath, aimId: c.aimId }).catch(() => null)
          ));
          const childContext = children
            .filter((c: any) => c !== null)
            .map((c: any) => ({ id: c.id, text: c.text, description: c.description }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                    aim: { id: aim.id, text: aim.text, description: aim.description },
                    semantic_context: semanticContext,
                    parents: parentContext,
                    children: childContext
                }, null, 2),
              },
            ],
          };
        }

        case "list_phase_aims_recursive": {
            // 1. Get all aims (cache them)
            const allAims: any[] = await trpcClient.aim.list.query({
                projectPath: args.projectPath as string,
            });
            const aimMap = new Map(allAims.map((a: any) => [a.id, a]));

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

            function buildTree(aimId: string): any | null {
                if (visited.has(aimId)) return null; // Cycle detection
                visited.add(aimId);

                const aim = aimMap.get(aimId);
                if (!aim) return null;

                const children = (aim.supportingConnections || [])
                    .map((conn: any) => buildTree(typeof conn === 'string' ? conn : conn.aimId))
                    .filter((c: any) => c !== null);

                const node = {
                    id: aim.id,
                    text: aim.text,
                    description: aim.description,
                    status: aim.status.state,
                    children: children
                };

                const isOpen = (allowedStatuses as string[]).includes(aim.status.state);
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
        }

        case "search_aims": {
          const aims = await trpcClient.aim.search.query({
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
                text: JSON.stringify(formatAims(aims), null, 2),
              },
            ],
          };
        }

        case "list_phases": {
          const phases = await trpcClient.phase.list.query({
            projectPath: args.projectPath as string,
            parentPhaseId: args.parentPhaseId as string | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(phases, null, 2),
              },
            ],
          };
        }

        case "search_phases": {
          const phases = await trpcClient.phase.search.query({
            projectPath: args.projectPath as string,
            query: args.query as string,
            parentPhaseId: args.parentPhaseId as string | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(phases, null, 2),
              },
            ],
          };
        }

        case "create_aim": {
          const result = await trpcClient.aim.createFloatingAim.mutate({
            projectPath: args.projectPath as string,
            aim: {
              text: args.text as string,
              description: args.description as string | undefined,
              tags: args.tags as string[] | undefined,
              status: (args.status as any) || {
                state: "open",
                comment: "",
                date: Date.now(),
              },
            },
          });

          // Handle supportingConnections (children)
          const children = (args.supportingConnections as string[]) || [];
          for (const childId of children) {
            await trpcClient.aim.connectAims.mutate({
              projectPath: args.projectPath as string,
              parentAimId: result.id,
              childAimId: childId,
            });
          }

          // Handle supportedAims (parents)
          const parents = (args.supportedAims as string[]) || [];
          for (const parentId of parents) {
            await trpcClient.aim.connectAims.mutate({
              projectPath: args.projectPath as string,
              parentAimId: parentId,
              childAimId: result.id,
            });
          }

          // If phaseId provided, commit to phase
          if (args.phaseId) {
            await trpcClient.aim.commitToPhase.mutate({
              projectPath: args.projectPath as string,
              aimId: result.id,
              phaseId: args.phaseId as string,
            });
          }

          return {
            content: [
              {
                type: "text",
                text: `Created aim with ID: ${result.id}${args.phaseId ? ` and committed to phase ${args.phaseId}` : ''}`,
              },
            ],
          };
        }

        case "update_aim": {
          const updateData: any = {};
          if (args.text) updateData.text = args.text;
          if (args.description !== undefined) updateData.description = args.description;
          if (args.tags) updateData.tags = args.tags;
          if (args.status) updateData.status = args.status;
          
          if (args.supportingConnections) {
              updateData.supportingConnections = (args.supportingConnections as string[]).map(id => ({
                  aimId: id,
                  weight: 1,
                  relativePosition: [0,0]
              }));
          }
          if (args.supportedAims) updateData.supportedAims = args.supportedAims;

          await trpcClient.aim.update.mutate({
            projectPath: args.projectPath as string,
            aimId: args.aimId as string,
            aim: updateData,
          });
          return {
            content: [
              {
                type: "text",
                text: `Updated aim ${args.aimId}`,
              },
            ],
          };
        }

        case "delete_aim": {
          await trpcClient.aim.delete.mutate({
            projectPath: args.projectPath as string,
            aimId: args.aimId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Deleted aim ${args.aimId}`,
              },
            ],
          };
        }

        case "addReflection": {
          const result = await trpcClient.aim.addReflection.mutate({
            projectPath: args.projectPath as string,
            aimId: args.aimId as string,
            reflection: args.reflection as any,
          });
          return {
            content: [
              {
                type: "text",
                text: `Added reflection to aim ${args.aimId}`,
              },
            ],
          };
        }

        case "create_phase": {
          const result = await trpcClient.phase.create.mutate({
            projectPath: args.projectPath as string,
            phase: {
              name: args.name as string,
              parent: (args.parent as string | null) || null,
              commitments: [],
            },
          });
          return {
            content: [
              {
                type: "text",
                text: `Created phase with ID: ${result.id}`,
              },
            ],
          };
        }

        case "update_phase": {
          const updateData: any = {};
          if (args.name !== undefined) updateData.name = args.name;
          if (args.parent !== undefined) updateData.parent = args.parent;

          await trpcClient.phase.update.mutate({
            projectPath: args.projectPath as string,
            phaseId: args.phaseId as string,
            phase: updateData,
          });
          return {
            content: [
              {
                type: "text",
                text: `Updated phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "delete_phase": {
          await trpcClient.phase.delete.mutate({
            projectPath: args.projectPath as string,
            phaseId: args.phaseId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Deleted phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "commit_aim_to_phase": {
          await trpcClient.aim.commitToPhase.mutate({
            projectPath: args.projectPath as string,
            aimId: args.aimId as string,
            phaseId: args.phaseId as string,
            insertionIndex: args.insertionIndex as number | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: `Committed aim ${args.aimId} to phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "remove_aim_from_phase": {
          await trpcClient.aim.removeFromPhase.mutate({
            projectPath: args.projectPath as string,
            aimId: args.aimId as string,
            phaseId: args.phaseId as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Removed aim ${args.aimId} from phase ${args.phaseId}`,
              },
            ],
          };
        }

        case "get_active_path": {
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
        }

        case "get_prioritized_aims": {
          // Fetch all phases once; we need them for both explicit lookup and time-based resolution.
          // parentPhaseId omitted → backend returns all phases
          const allPhases: any[] = await trpcClient.phase.list.query({
            projectPath: args.projectPath as string,
          });
          const phaseById = new Map<string, any>(allPhases.map((p: any) => [p.id, p]));

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
          // high-value goals (e.g. ASI) into the sub-aims that support them and
          // cost aggregates bottom-up. Ranking a single aim by its own
          // intrinsicValue/cost ignores the graph and is near-useless when most
          // intrinsic value sits at the top.
          const allAims = await trpcClient.aim.list.query({
            projectPath: args.projectPath as string,
          });
          const { priorities, values, costs, totalIntrinsic } = calculateAimValues(allAims as any);

          const aimIdSet = new Set<string>(targetPhase.commitments ?? []);
          const openInPhase = (allAims as any[]).filter(
            (a: any) => aimIdSet.has(a.id) && a.status.state === 'open'
          );

          // Diagnostics: how many committed aims are missing economic data
          const allCommitted = (allAims as any[]).filter((a: any) => aimIdSet.has(a.id));
          const missingCost = allCommitted.filter((a: any) => !a.cost || a.cost <= 0).length;
          // An aim with effectively-zero flowed value is disconnected from any intrinsic
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

          const prioritized = openInPhase
            .map((a: any) => ({
              ...a,
              _priority: priorities.get(a.id) ?? 0,
              _flowedValue: (values.get(a.id) ?? 0) * totalIntrinsic,
              _aggregatedCost: costs.get(a.id) ?? 0,
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
                  model: "flow-based (top-down value, bottom-up cost, NPV/cost priority)",
                  economics: {
                    phaseFlowedValue: fmt(phaseFlowedValue),
                    phaseTotalCost: fmt(phaseTotalCost),
                    phaseValueFraction: (phaseValueFraction * 100).toFixed(1) + "%",
                    totalGraphIntrinsicValue: totalIntrinsic,
                  },
                  diagnostics: {
                    committedAims: allCommitted.length,
                    openAims: openInPhase.length,
                    missingCostEstimate: missingCost,
                    disconnectedFromValue: missingValue,
                    note: missingValue > 0
                      ? `${missingValue} aim(s) have zero flowed value — they are disconnected from any intrinsic value source in the graph. Their priorities are unreliable.`
                      : missingCost > 0
                        ? `${missingCost} aim(s) lack a cost estimate. Set via update_aim { cost: N }.`
                        : "All committed aims have economic data.",
                  },
                  aims: prioritized.map((a: any) => ({
                    id: a.id,
                    text: a.text,
                    description: a.description,
                    priority: fmt(a._priority),
                    flowedValue: fmt(a._flowedValue),
                    aggregatedCost: fmt(a._aggregatedCost),
                    intrinsicValue: a.intrinsicValue,
                    rawCost: a.cost,
                    status: a.status?.state,
                  })),
                }, null, 2),
              },
            ],
          };
        }

        case "list_aims": {
          const aims = await trpcClient.aim.list.query({
            projectPath: args.projectPath as string,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
            floating: args.floating as boolean | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(aims.map(formatAim), null, 2) }],
          };
        }

        case "check_consistency": {
          const result = await trpcClient.project.checkConsistency.query({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "fix_consistency": {
          const result = await trpcClient.project.fixConsistency.mutate({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "build_search_index": {
          const result = await trpcClient.project.buildSearchIndex.mutate({
            projectPath: args.projectPath as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "search_aims_semantic": {
          const results = await trpcClient.aim.searchSemantic.query({
            projectPath: args.projectPath as string,
            query: args.query as string,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
            limit: args.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(results.map(formatAim), null, 2) }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${errorMessage}\n\nPlease check that:\n1. The projectPath is correct and absolute\n2. All UUIDs are valid and exist\n3. The backend server is running on ws://localhost:${process.env.PORT_BACKEND_WS || '3001'}`,
          },
        ],
        isError: true,
      };
    }
  });
}
