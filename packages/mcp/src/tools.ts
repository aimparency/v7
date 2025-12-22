import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { trpc } from "./client.js";
import { AIM_STATES, AIM_STATES_DESCRIPTION, PROJECT_PATH_TOOL_PROPERTY } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AIMPARENCY_DIR_NAME } from "shared";

function formatAim(aim: any) {
  if (aim.supportingConnections) {
    aim.supportingConnections = aim.supportingConnections.map((conn: any) => {
      const { relativePosition, ...rest } = conn;
      return rest;
    });
  }
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
          description: "Get a single aim by its ID",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string", description: "UUID of the aim" }
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "list_aims",
          description: "List all aims in the project",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              ids: {
                type: "array",
                items: { type: "string" },
                description: "Filter by specific aim IDs"
              },
              status: {
                type: ["string", "array"],
                items: { type: "string" },
                description: "Filter by status (e.g., 'open' or ['open', 'in_progress'])"
              },
              phaseId: {
                type: "string",
                description: "Filter by phase ID"
              },
              parentAimId: {
                type: "string",
                description: "Filter by parent aim ID (get sub-aims)"
              },
              floating: {
                type: "boolean",
                description: "Filter for aims that are not committed to any phase and have no parents"
              },
              archived: {
                type: "boolean",
                description: "If true, list only archived aims. If false/omitted, list only active aims."
              },
              limit: { type: "number", description: "Limit number of results" },
              offset: { type: "number", description: "Skip first N results" },
              sortBy: { type: "string", enum: ["date", "status", "text", "priority"], description: "Sort by field" },
              sortOrder: { type: "string", enum: ["asc", "desc"], description: "Sort order (default asc)" }
            },
            required: ["projectPath"],
          },
        },
        {
          name: "list_phase_aims_recursive",
          description: "List all open aims and sub-aims recursively for a given phase.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string", description: "UUID of the phase" },
              status: {
                  type: ["string", "array"],
                  items: { type: "string" },
                  description: "Filter by status (default: ['open'])"
              }
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "search_aims",
          description: "Search aims by text or status (e.g. 'open', 'done')",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              query: { type: "string" },
              status: {
                type: ["string", "array"],
                items: { type: "string" },
                description: "Filter by status"
              },
              phaseId: {
                type: "string",
                description: "Filter by phase ID"
              },
              archived: {
                type: "boolean",
                description: "If true, search only archived aims."
              },
              limit: { type: "number", description: "Limit number of results" },
              offset: { type: "number", description: "Skip first N results" }
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "search_aims_semantic",
          description: "Search aims by semantic meaning (embedding-based)",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              query: { type: "string" },
              limit: { type: "number", description: "Max results (default 10)" },
              status: {
                type: ["string", "array"],
                items: { type: "string" },
                description: "Filter by status"
              },
              phaseId: {
                type: "string",
                description: "Filter by phase ID"
              }
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "list_phases",
          description: "List phases in the project. Defaults to listing currently active phases (at current time) unless 'all' is set to true. Use this to find the active context to prioritize work.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              parentPhaseId: { type: ["string", "null"], description: "Optional parent phase ID" },
              activeAt: { type: "number", description: "Optional timestamp (ms) to filter active phases. Defaults to current time if not provided and 'all' is false." },
              all: { type: "boolean", description: "Set to true to list all phases regardless of time." }
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
              parentPhaseId: { type: ["string", "null"], description: "Optional parent phase ID" },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "create_aim",
          description: "Create a new aim. Date is set automatically. Optionally provide phaseId to commit to a phase in one step.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              text: {
                type: "string",
                description: "The aim text/description",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags for categorization (e.g. 'bug', 'feature')",
              },
              status: {
                type: "object",
                properties: {
                  state: {
                    type: "string",
                    description: AIM_STATES_DESCRIPTION,
                  },
                  comment: {
                    type: "string",
                    description: "Optional comment about the status",
                  },
                },
              },
              supportingConnections: {
                type: "array",
                items: { type: "string" },
                description: "UUIDs of aims that support this aim (children/dependencies)",
              },
              supportedAims: {
                type: "array",
                items: { type: "string" },
                description: "UUIDs of aims that this aim supports (parents)",
              },
              phaseId: {
                type: "string",
                description: "Optional: UUID of phase to commit this aim to",
              },
            },
            required: ["projectPath", "text"],
          },
        },
        {
          name: "update_aim",
          description: `Update an aim's text, status (open/done/cancelled/partially/failed), or dependency relationships. It's recommended, to update aims before using git add for the code changes and ${AIMPARENCY_DIR_NAME}, in order to commit code and related aim changes at the same time.`,
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string", description: "UUID of the aim to update" },
              text: { type: "string" },
              tags: {
                type: "array",
                items: { type: "string" },
              },
              status: {
                type: "object",
                properties: {
                  state: {
                    type: "string",
                    description: AIM_STATES_DESCRIPTION,
                  },
                  comment: { type: "string" },
                },
              },
              supportingConnections: {
                type: "array",
                items: { type: "string" },
                description: "UUIDs of aims that support this aim (children/dependencies)",
              },
              supportedAims: {
                type: "array",
                items: { type: "string" },
                description: "UUIDs of aims that this aim supports (parents)",
              },
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "delete_aim",
          description: "Delete an aim permanently. Automatically removes it from all phases it's committed to. Prefer updating aim status to 'cancelled' instead. Use deletion only for duplicates or errors.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string", description: "UUID of the aim to delete" },
            },
            required: ["projectPath", "aimId"],
          },
        },
        {
          name: "create_phase",
          description: "Create a time-boxed phase. Provide dates as Unix timestamps (milliseconds). Set parent to null for root phase or a phase UUID for sub-phase.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              name: { type: "string", description: "Phase name" },
              from: {
                type: "number",
                description: "Start date as Unix timestamp (milliseconds)",
              },
              to: {
                type: "number",
                description: "End date as Unix timestamp (milliseconds)",
              },
              parent: {
                type: ["string", "null"],
                description: "UUID of parent phase, or null for root phase",
              },
            },
            required: ["projectPath", "name", "from", "to"],
          },
        },
        {
          name: "update_phase",
          description: "Update a phase's name, time range, or parent phase",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string", description: "UUID of the phase to update" },
              name: { type: "string" },
              from: { type: "number" },
              to: { type: "number" },
              parent: { type: ["string", "null"] },
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "delete_phase",
          description: "Delete a phase. Aims are NOT deleted, only uncommitted from this phase.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              phaseId: { type: "string", description: "UUID of the phase to delete" },
            },
            required: ["projectPath", "phaseId"],
          },
        },
        {
          name: "commit_aim_to_phase",
          description: "Commit an existing aim to a phase. Optionally specify insertionIndex for ordering.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              aimId: { type: "string", description: "UUID of the aim" },
              phaseId: { type: "string", description: "UUID of the phase" },
              insertionIndex: {
                type: "number",
                description: "Optional position to insert (0-based), omit to append",
              },
            },
            required: ["projectPath", "aimId", "phaseId"],
          },
        },
        {
          name: "remove_aim_from_phase",
          description: "Remove an aim from a phase. The aim itself is not deleted.",
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
          name: "update_project_meta",
          description: "Update project name and color. Color must be hex format (#RRGGBB).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              name: { type: "string", description: "Project name" },
              color: {
                type: "string",
                description: "Hex color code (e.g., #FF5733)",
                pattern: "^#[0-9a-fA-F]{6}$",
              },
              statuses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }
                  },
                  required: ["key", "color"]
                },
                description: "Custom aim statuses"
              }
            },
            required: ["projectPath", "name", "color"],
          },
        },
        {
          name: "get_system_status",
          description: "Get the current system status including compute credits and funds. Use this to check if the agent has enough resources to continue working or needs to earn more.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
        {
          name: "perform_work",
          description: "Perform work to earn compute credits and funds. Use this when system status shows low resources.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              workType: {
                type: "string",
                enum: ["mining", "freelance"],
                description: "Type of work to perform (default: mining)"
              }
            },
            required: ["projectPath"],
          },
        },
        {
          name: "build_search_index",
          description: "Rebuild the search index and generate embeddings for all aims. Use this if search results seem outdated or missing.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
        {
          name: "check_consistency",
          description: "Check for data inconsistencies between aims, phases, and relationships (e.g. broken links, missing parents/children). Returns a list of errors if any found.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
        {
          name: "fix_consistency",
          description: "Automatically fix data inconsistencies found by check-consistency. Use with caution as it may remove invalid relationships.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
            },
            required: ["projectPath"],
          },
        },
        {
          name: "update_system_status",
          description: "Manually update system status (compute credits, funds). Primarily for administrative use or manual adjustments.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              computeCredits: { type: "number", description: "New compute credits balance" },
              funds: { type: "number", description: "New funds balance" }
            },
            required: ["projectPath"],
          },
        },
        {
          name: "get_prioritized_aims",
          description: "Get all aims from the lowest (deepest) active phase, prioritized by value/cost ratio.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              limit: { type: "number", description: "Limit number of results (default 10)" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "update_market_config",
          description: "Update Market Alpha trading hyperparameters (risk, leverage, strategy).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: PROJECT_PATH_TOOL_PROPERTY,
              risk_level: { type: "number", description: "Risk multiplier (e.g. 1.5)" },
              leverage: { type: "number", description: "Leverage factor (e.g. 2.0)" },
              strategy: { type: "string", description: "Trading strategy name" }
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

        case "list_aims": {
          const aims = await trpcClient.aim.list.query({
            projectPath: args.projectPath as string,
            ids: args.ids as string[] | undefined,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
            parentAimId: args.parentAimId as string | undefined,
            floating: args.floating as boolean | undefined,
            archived: args.archived as boolean | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
            sortBy: args.sortBy as "date" | "status" | "text" | undefined,
            sortOrder: args.sortOrder as "asc" | "desc" | undefined,
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

        case "search_aims_semantic": {
          const aims = await trpcClient.aim.searchSemantic.query({
            projectPath: args.projectPath as string,
            query: args.query as string,
            limit: args.limit as number | undefined,
            status: args.status as string | string[] | undefined,
            phaseId: args.phaseId as string | undefined,
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
          const all = args.all as boolean | undefined;
          let activeAt = args.activeAt as number | undefined;
          
          if (!all && activeAt === undefined) {
              activeAt = Date.now();
          }

          const phases = await trpcClient.phase.list.query({
            projectPath: args.projectPath as string,
            parentPhaseId: args.parentPhaseId as string | undefined,
            activeAt: activeAt,
            all: all
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

        case "create_phase": {
          const result = await trpcClient.phase.create.mutate({
            projectPath: args.projectPath as string,
            phase: {
              name: args.name as string,
              from: args.from as number,
              to: args.to as number,
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
          if (args.from !== undefined) updateData.from = args.from;
          if (args.to !== undefined) updateData.to = args.to;
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

        case "update_project_meta": {
          await trpcClient.project.updateMeta.mutate({
            projectPath: args.projectPath as string,
            meta: {
              name: args.name as string,
              color: args.color as string,
            },
          });
          return {
            content: [
              {
                type: "text",
                text: "Updated project metadata",
              },
            ],
          };
        }

        case "get_system_status": {
          const status = await trpcClient.system.getStatus.query({
            projectPath: args.projectPath as string,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(status, null, 2),
              },
            ],
          };
        }

        case "perform_work": {
          const result = await trpcClient.system.performWork.mutate({
            projectPath: args.projectPath as string,
            workType: (args.workType as "mining" | "freelance") || "mining",
          });
          return {
            content: [
              {
                type: "text",
                text: `Work completed successfully.\nEarned: ${result.earned.credits} credits, ${result.earned.funds} funds.\nNew Balance: ${result.computeCredits} credits, ${result.funds} funds.`,
              },
            ],
          };
        }

        case "build_search_index": {
          const result = await trpcClient.project.buildSearchIndex.mutate({
            projectPath: args.projectPath as string,
          });
          return {
            content: [
              {
                type: "text",
                text: `Search index rebuild initiated.\nIndexed: ${result.indexed.aims} aims, ${result.indexed.phases} phases.\nEmbeddings are generating in the background.`,
              },
            ],
          };
        }

        case "check_consistency": {
          const result = await trpcClient.project.checkConsistency.query({
            projectPath: args.projectPath as string,
          });
          return {
            content: [
              {
                type: "text",
                text: result.valid 
                  ? "Data consistency check passed. No errors found."
                  : `Data consistency check FAILED.\nErrors found:\n${result.errors.map((e: any) => `- ${e}`).join('\n')}`,
              },
            ],
          };
        }

        case "fix_consistency": {
          const result = await trpcClient.project.fixConsistency.mutate({
            projectPath: args.projectPath as string,
          });
          return {
            content: [
              {
                type: "text",
                text: result.fixes.length > 0
                  ? `Consistency repairs completed.\nFixes applied:\n${result.fixes.map((f: any) => `- ${f}`).join('\n')}`
                  : "No inconsistencies found to fix.",
              },
            ],
          };
        }

        case "update_system_status": {
          const statusUpdate: any = {};
          if (args.computeCredits !== undefined) statusUpdate.computeCredits = args.computeCredits;
          if (args.funds !== undefined) statusUpdate.funds = args.funds;

          const result = await trpcClient.system.updateStatus.mutate({
            projectPath: args.projectPath as string,
            status: statusUpdate,
          });
          return {
            content: [
              {
                type: "text",
                text: `System status updated.\nNew Balance: ${result.computeCredits} credits, ${result.funds} funds.`,
              },
            ],
          };
        }

        case "get_prioritized_aims": {
          // ... (existing code for get_prioritized_aims)
          // (Truncated for brevity in tool call but I will preserve it)
          const now = Date.now();
          const phases = await trpcClient.phase.list.query({ 
              projectPath: args.projectPath as string, 
              activeAt: now 
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

          // If multiple leaves, pick the one ending soonest
          leaves.sort((a: any, b: any) => a.to - b.to);
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
                        text: a.text,
                        priority: a.priority.toFixed(2),
                        value: a.intrinsicValue,
                        cost: a.cost
                    }))
                }, null, 2),
              },
            ],
          };
        }

        case "update_market_config": {
          const config: any = {};
          if (args.risk_level !== undefined) config.risk_level = args.risk_level;
          if (args.leverage !== undefined) config.leverage = args.leverage;
          if (args.strategy !== undefined) config.strategy = args.strategy;

          const result = await trpcClient.market.updateConfig.mutate({
            projectPath: args.projectPath as string,
            config
          });

          return {
            content: [
              {
                type: "text",
                text: `Market Alpha config updated.\nNew Config: ${JSON.stringify(result, null, 2)}`,
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