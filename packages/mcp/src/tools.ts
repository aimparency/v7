import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

            // 2. Get the phase to find roots
            const phases = await trpcClient.phase.list.query({
                projectPath: args.projectPath as string,
                all: true
            });
            const phase = phases.find((p: any) => p.id === args.phaseId);
            if (!phase) throw new Error(`Phase ${args.phaseId} not found`);

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

        case "get_prioritized_aims": {
          const phases = await trpcClient.phase.list.query({
              projectPath: args.projectPath as string,
          });

          if (phases.length === 0) {
               return { content: [{ type: "text", text: "No active phases found." }] };
          }

          // Find phases with no active children (leaves)
          // Map parent -> children
          const parentMap = new Map<string, string[]>();
          phases.forEach((p: any) => {
              if (p.parent) {
                  if (!parentMap.has(p.parent)) parentMap.set(p.parent, []);
                  parentMap.get(p.parent)!.push(p.id);
              }
          });

          // Filter for active leaves
          const leaves = phases.filter((p: any) => {
              const children = parentMap.get(p.id);
              // If no children, it's a leaf. 
              // If children exist, check if any are in the active 'phases' list
              if (!children) return true;
              return !children.some((childId: string) => phases.some((active: any) => active.id === childId));
          });

          const targetPhase = leaves[0];

          if (!targetPhase) {
               return { content: [{ type: "text", text: "No active leaf phases found." }] };
          }

          // Get aims
          const aimIds = targetPhase.commitments;
          const aims = await Promise.all(aimIds.map((id: string) => trpcClient.aim.get.query({ 
              projectPath: args.projectPath as string, 
              aimId: id 
          })));

          // Prioritize
          const prioritized = aims
              .filter((a: any) => a.status.state === 'open') // Only open aims
              .map((a: any) => {
                  const cost = (a.cost && a.cost > 0) ? a.cost : 0.1; // Avoid div by zero
                  const priority = (a.intrinsicValue || 0) / cost;
                  return { ...a, priority };
              })
              .sort((a: any, b: any) => b.priority - a.priority)
              .slice(0, (args.limit as number) || 10);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                    phase: targetPhase.name,
                    aims: prioritized.map((a: any) => ({
                        id: a.id,
                        text: a.text,
                        description: a.description,
                        priority: a.priority.toFixed(2),
                        value: a.intrinsicValue,
                        cost: a.cost
                    }))
                }, null, 2),
              },
            ],
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
