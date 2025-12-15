#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { WebSocket } from "ws";
import type { AppRouter } from "backend";
import { z } from "zod";

// Create tRPC client to backend
const wsClient = createWSClient({
  url: "ws://localhost:3001",
  WebSocket: WebSocket as any,
});

const trpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })],
});

// Constants
const AIM_STATES = ["open", "done", "cancelled", "partially", "failed"];
const AIM_STATES_DESCRIPTION = `Current status of the aim. Options: ${AIM_STATES.join(", ")}`;

const SUBDIR_NAME = ".bowman"
const PROJECT_PATH_DESCRIPTION = `Absolute path to the project directory. For a repository it defaults to /path/to/repo/${SUBDIR_NAME}. So be careful to append /${SUBDIR_NAME} to the repo directory if no otherwise specified`

const PROJECT_PATH_TOOL_PROPERTY = {
  type: "string",
  description: PROJECT_PATH_DESCRIPTION
};

const PROJECT_PATH_PROMPT_ARGUMENT = {
  name: "projectPath",
  description: PROJECT_PATH_DESCRIPTION,
  required: true
};

// Create MCP server
const server = new Server(
  {
    name: "aimparency",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// Helper to parse resource URIs
function parseResourceUri(uri: string): { type: string; id?: string; subpath?: string } {
  // Remove query parameters before parsing
  const uriWithoutQuery = uri.split('?')[0];
  const match = uriWithoutQuery.match(/^(\w+):\/\/([^/]+)(?:\/(.+))?$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }
  return {
    type: match[1],
    id: match[2],
    subpath: match[3],
  };
}

const PROJECT_PATH_PARAMETER = `projectPath=/abs/path/${SUBDIR_NAME}`

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: `aim://{uuid}?${PROJECT_PATH_PARAMETER}`,
        name: "Single aim",
        description: "Get a specific aim's text, status, and relationships. Replace {uuid} with actual aim ID. It's advised to know an aims supported aims recursively to fully understand it. Aims can have different states",
        mimeType: "application/json",
      },
      {
        uri: `aim://{uuid}/supporting-connections?${PROJECT_PATH_PARAMETER}`,
        name: `Supporting connections (Children)`,
        description: `Get all aims that support this aim (dependencies/prerequisites)`,
        mimeType: `application/json`,
      },
      {
        uri: `aim://{uuid}/supported-aims?${PROJECT_PATH_PARAMETER}`,
        name: `Supported aims (Parents)`,
        description: `Get all aims that this aim supports (aims that depend on this aim)`,
        mimeType: `application/json`,
      },
      {
        uri: `aims://all?${PROJECT_PATH_PARAMETER}`,
        name: `All aims`,
        description: `List all aims in the project with their full details`,
        mimeType: `application/json`,
      },
      {
        uri: `phase://{uuid}?${PROJECT_PATH_PARAMETER}`,
        name: `Single phase`,
        description: `Get a phase's name, date range, parent, and committed aims. Replace {uuid} with actual phase ID. A phase is a temporal window in which aims can be focused. Phases can have subphases, think YEAR>MONTHS>WEEKS for example. Phases help to focus on a set of aims in a given frame of time. Phases on the same level (siblings) are rather sequential.`,
        mimeType: `application/json`,
      },
      {
        uri: `phase://{uuid}/aims?${PROJECT_PATH_PARAMETER}`,
        name: `Phase aims`,
        description: `Get full details of all aims committed to this phase`,
        mimeType: `application/json`,
      },
      {
        uri: `phases://all?${PROJECT_PATH_PARAMETER}`,
        name: `All phases`,
        description: `List all phases in the project (root and sub-phases)`,
        mimeType: `application/json`,
      },
      {
        uri: `phases://{parent-uuid}/children?${PROJECT_PATH_PARAMETER}`,
        name: `Sub-phases`,
        description: `List all child phases of a specific parent phase`,
        mimeType: `application/json`,
      },
      {
        uri: `project://meta?${PROJECT_PATH_PARAMETER}`,
        name: `Project info`,
        description: `Get project name and color`,
        mimeType: `application/json`,
      },
    ],
  };
});

const PROJECT_PATH_MISSING_ERROR = `projectPath query parameter is required (e.g., aim://uuid?projectPath=/path/to/project/${SUBDIR_NAME})`
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const parsed = parseResourceUri(uri);

  try {
    // Extract projectPath from URI query parameter (e.g., aim://uuid?projectPath=/path/to/project)
    const url = new URL(uri, "http://dummy");
    const projectPath = url.searchParams.get("projectPath");

    if (!projectPath) {
      throw new Error(PROJECT_PATH_MISSING_ERROR);
    }

    if (parsed.type === "aim") {
      if (parsed.id === "all") {
        const aims = await trpc.aim.list.query({ projectPath });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(aims, null, 2),
            },
          ],
        };
      }

      const aim = await trpc.aim.get.query({ projectPath, aimId: parsed.id! });

      if (parsed.subpath === "supporting-connections") {
        const connections = aim.supportingConnections || [];
        const supportingAims = await Promise.all(
          connections.map((conn) => trpc.aim.get.query({ projectPath, aimId: conn.aimId }))
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(supportingAims, null, 2),
            },
          ],
        };
      }

      if (parsed.subpath === "supported-aims") {
        const supported = aim.supportedAims || [];
        const supportedAims = await Promise.all(
          supported.map((id) => trpc.aim.get.query({ projectPath, aimId: id }))
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(supportedAims, null, 2),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(aim, null, 2),
          },
        ],
      };
    }

    if (parsed.type === "aims" && parsed.id === "all") {
      const statusParam = url.searchParams.get("status");
      const phaseIdParam = url.searchParams.get("phaseId");
      
      const aims = await trpc.aim.list.query({ 
        projectPath,
        status: statusParam ? statusParam.split(',') : undefined,
        phaseId: phaseIdParam || undefined
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(aims, null, 2),
          },
        ],
      };
    }

    if (parsed.type === "phase") {
      const phase = await trpc.phase.get.query({ projectPath, phaseId: parsed.id! });

      if (parsed.subpath === "aims") {
        const aims = await Promise.all(
          phase.commitments.map((id) => trpc.aim.get.query({ projectPath, aimId: id }))
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(aims, null, 2),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(phase, null, 2),
          },
        ],
      };
    }

    if (parsed.type === "phases") {
      if (parsed.id === "all") {
        const phases = await trpc.phase.list.query({ projectPath });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(phases, null, 2),
            },
          ],
        };
      }

      if (parsed.subpath === "children") {
        const phases = await trpc.phase.list.query({ projectPath, parentPhaseId: parsed.id });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(phases, null, 2),
            },
          ],
        };
      }
    }

    if (parsed.type === "project" && parsed.id === "meta") {
      const meta = await trpc.project.getMeta.query({ projectPath });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(meta, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: `Error reading resource: ${errorMessage}\n\nMake sure to include projectPath as a query parameter, e.g.:\naim://uuid?projectPath=/abs/path/to/project/${SUBDIR_NAME}`,
        },
      ],
    };
  }
});

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get-aim",
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
        name: "list-aims",
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
            limit: { type: "number", description: "Limit number of results" },
            offset: { type: "number", description: "Skip first N results" },
            sortBy: { type: "string", enum: ["date", "status", "text"], description: "Sort by field" },
            sortOrder: { type: "string", enum: ["asc", "desc"], description: "Sort order (default asc)" }
          },
          required: ["projectPath"],
        },
      },
      {
        name: "search-aims",
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
            limit: { type: "number", description: "Limit number of results" },
            offset: { type: "number", description: "Skip first N results" }
          },
          required: ["projectPath", "query"],
        },
      },
      {
        name: "search-aims-semantic",
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
        name: "list-phases",
        description: "List phases in the project. Use this to find the currently active phase (via 'activeAt' timestamp) to prioritize work. Phases define the temporal context and priority.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: PROJECT_PATH_TOOL_PROPERTY,
            parentPhaseId: { type: ["string", "null"], description: "Optional parent phase ID" },
            activeAt: { type: "number", description: "Optional timestamp (ms) to filter active phases (from <= activeAt <= to)." }
          },
          required: ["projectPath"],
        },
      },
      {
        name: "search-phases",
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
        name: "create-aim",
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
                  enum: AIM_STATES,
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
        name: "update-aim",
        description: "Update an aim's text, status (open/done/cancelled/partially/failed), or dependency relationships",
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
                  enum: AIM_STATES,
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
        name: "delete-aim",
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
        name: "create-phase",
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
        name: "update-phase",
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
        name: "delete-phase",
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
        name: "commit-aim-to-phase",
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
        name: "remove-aim-from-phase",
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
        name: "update-project-meta",
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
          },
          required: ["projectPath", "name", "color"],
        },
      },
      {
        name: "get-system-status",
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
        name: "perform-work",
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
        name: "build-search-index",
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
        name: "check-consistency",
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
        name: "fix-consistency",
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
        name: "update-system-status",
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
        name: "get-prioritized-aims",
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
      case "get-aim": {
        const aim = await trpc.aim.get.query({
          projectPath: args.projectPath as string,
          aimId: args.aimId as string,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(aim, null, 2),
            },
          ],
        };
      }

      case "list-aims": {
        const aims = await trpc.aim.list.query({
          projectPath: args.projectPath as string,
          ids: args.ids as string[] | undefined,
          status: args.status as string | string[] | undefined,
          phaseId: args.phaseId as string | undefined,
          parentAimId: args.parentAimId as string | undefined,
          floating: args.floating as boolean | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
          sortBy: args.sortBy as "date" | "status" | "text" | undefined,
          sortOrder: args.sortOrder as "asc" | "desc" | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(aims, null, 2),
            },
          ],
        };
      }

      case "search-aims": {
        const aims = await trpc.aim.search.query({
          projectPath: args.projectPath as string,
          query: args.query as string,
          status: args.status as string | string[] | undefined,
          phaseId: args.phaseId as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(aims, null, 2),
            },
          ],
        };
      }

      case "search-aims-semantic": {
        const aims = await trpc.aim.searchSemantic.query({
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
              text: JSON.stringify(aims, null, 2),
            },
          ],
        };
      }

      case "list-phases": {
        const phases = await trpc.phase.list.query({
          projectPath: args.projectPath as string,
          parentPhaseId: args.parentPhaseId as string | undefined,
          activeAt: args.activeAt as number | undefined,
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

      case "search-phases": {
        const phases = await trpc.phase.search.query({
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

      case "create-aim": {
        const result = await trpc.aim.createFloatingAim.mutate({
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
        // These aims support the new aim (dependencies).
        // Wait, supportingConnections = "Aims that support this aim" (Children).
        // If Child supports Parent.
        // Then Child -> Parent.
        // So Parent depends on Child.
        // If I create X, and Y supports X.
        // Y is Child, X is Parent.
        // Link X (Parent) -> Y (Child).
        // connectAims(parent=X, child=Y).
        const children = (args.supportingConnections as string[]) || [];
        for (const childId of children) {
          await trpc.aim.connectAims.mutate({
            projectPath: args.projectPath as string,
            parentAimId: result.id,
            childAimId: childId,
          });
        }

        // Handle supportedAims (parents)
        // These aims are supported by the new aim.
        // If X supports Z.
        // X is Child, Z is Parent.
        // Link Z (Parent) -> X (Child).
        // connectAims(parent=Z, child=X).
        const parents = (args.supportedAims as string[]) || [];
        for (const parentId of parents) {
          await trpc.aim.connectAims.mutate({
            projectPath: args.projectPath as string,
            parentAimId: parentId,
            childAimId: result.id,
          });
        }

        // If phaseId provided, commit to phase
        if (args.phaseId) {
          await trpc.aim.commitToPhase.mutate({
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

      case "update-aim": {
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

        await trpc.aim.update.mutate({
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

      case "delete-aim": {
        await trpc.aim.delete.mutate({
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

      case "create-phase": {
        const result = await trpc.phase.create.mutate({
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

      case "update-phase": {
        const updateData: any = {};
        if (args.name !== undefined) updateData.name = args.name;
        if (args.from !== undefined) updateData.from = args.from;
        if (args.to !== undefined) updateData.to = args.to;
        if (args.parent !== undefined) updateData.parent = args.parent;

        await trpc.phase.update.mutate({
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

      case "delete-phase": {
        await trpc.phase.delete.mutate({
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

      case "commit-aim-to-phase": {
        await trpc.aim.commitToPhase.mutate({
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

      case "remove-aim-from-phase": {
        await trpc.aim.removeFromPhase.mutate({
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

      case "update-project-meta": {
        await trpc.project.updateMeta.mutate({
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
              text: `Updated project metadata`,
            },
          ],
        };
      }

      case "get-system-status": {
        const status = await trpc.system.getStatus.query({
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

      case "perform-work": {
        const result = await trpc.system.performWork.mutate({
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

      case "build-search-index": {
        const result = await trpc.project.buildSearchIndex.mutate({
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

      case "check-consistency": {
        const result = await trpc.project.checkConsistency.query({
          projectPath: args.projectPath as string,
        });
        return {
          content: [
            {
              type: "text",
              text: result.valid 
                ? "Data consistency check passed. No errors found." 
                : `Data consistency check FAILED.\nErrors found:\n${result.errors.map(e => `- ${e}`).join('\n')}`,
            },
          ],
        };
      }

      case "fix-consistency": {
        const result = await trpc.project.fixConsistency.mutate({
          projectPath: args.projectPath as string,
        });
        return {
          content: [
            {
              type: "text",
              text: result.fixes.length > 0
                ? `Consistency repairs completed.\nFixes applied:\n${result.fixes.map(f => `- ${f}`).join('\n')}`
                : "No inconsistencies found to fix.",
            },
          ],
        };
      }

      case "update-system-status": {
        const statusUpdate: any = {};
        if (args.computeCredits !== undefined) statusUpdate.computeCredits = args.computeCredits;
        if (args.funds !== undefined) statusUpdate.funds = args.funds;

        const result = await trpc.system.updateStatus.mutate({
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

      case "get-prioritized-aims": {
        const now = Date.now();
        const phases = await trpc.phase.list.query({ 
            projectPath: args.projectPath as string, 
            activeAt: now 
        });

        if (phases.length === 0) {
             return { content: [{ type: "text", text: "No active phases found." }] };
        }

        // Find phases with no active children (leaves)
        // Map parent -> children
        const parentMap = new Map<string, string[]>();
        phases.forEach(p => {
            if (p.parent) {
                if (!parentMap.has(p.parent)) parentMap.set(p.parent, []);
                parentMap.get(p.parent)!.push(p.id);
            }
        });

        // Filter for active leaves
        const leaves = phases.filter(p => {
            const children = parentMap.get(p.id);
            // If no children, it's a leaf. 
            // If children exist, check if any are in the active 'phases' list
            if (!children) return true;
            return !children.some(childId => phases.some(active => active.id === childId));
        });

        // If multiple leaves, pick the one ending soonest
        leaves.sort((a, b) => a.to - b.to);
        const targetPhase = leaves[0];

        if (!targetPhase) {
             return { content: [{ type: "text", text: "No active leaf phases found." }] };
        }

        // Get aims
        const aimIds = targetPhase.commitments;
        const aims = await Promise.all(aimIds.map(id => trpc.aim.get.query({ 
            projectPath: args.projectPath as string, 
            aimId: id 
        })));

        // Prioritize
        const prioritized = aims
            .filter(a => a.status.state === 'open') // Only open aims
            .map(a => {
                const cost = (a.cost && a.cost > 0) ? a.cost : 0.1; // Avoid div by zero
                const priority = (a.intrinsicValue || 0) / cost;
                return { ...a, priority };
            })
            .sort((a, b) => b.priority - a.priority)
            .slice(0, (args.limit as number) || 10);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                  phase: targetPhase.name,
                  aims: prioritized.map(a => ({
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${errorMessage}\n\nPlease check that:\n1. The projectPath is correct and absolute\n2. All UUIDs are valid and exist\n3. The backend server is running on ws://localhost:3001`,
        },
      ],
      isError: true,
    };
  }
});

// Register prompt handlers
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "breakdown",
        description: "Break a complex aim into 3-5 smaller sub-aims and establish dependency relationships between them",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          {
            name: "aimId",
            description: "UUID of the aim to break down",
            required: true,
          },
        ],
      },
      {
        name: "analyze-dependencies",
        description: "Analyze aim relationships and suggest improvements",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
        ],
      },
      {
        name: "plan-phase",
        description: "Help plan which aims to commit to a phase based on dependencies and status",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          {
            name: "phaseId",
            description: "UUID of the phase to plan",
            required: true,
          },
        ],
      },
      {
        name: "review-progress",
        description: "Review phase commitments vs aim statuses and suggest next actions",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          {
            name: "phaseId",
            description: "UUID of the phase to review",
            required: true,
          },
        ],
      },
      {
        name: "hypothesis-test",
        description: "Structure an aim as a testable hypothesis with success criteria",
        arguments: [
          PROJECT_PATH_PROMPT_ARGUMENT,
          {
            name: "aimId",
            description: "UUID of the aim to structure as hypothesis",
            required: true,
          },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (!args) {
      throw new Error("Arguments are required for prompts");
    }

    const projectPath = args.projectPath as string;
    if (!projectPath) {
      throw new Error("projectPath argument is required");
    }

    switch (name) {
      case "breakdown": {
        const aimId = args.aimId as string;
        if (!aimId) {
          throw new Error("aimId argument is required");
        }

        const aim = await trpc.aim.get.query({ projectPath, aimId });
        const allAims = await trpc.aim.list.query({ projectPath });

        return {
          description: `Break down aim "${aim.text}" into smaller sub-aims`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `I need help breaking down this aim into smaller, manageable sub-aims:

**Current Aim:**
- ID: ${aim.id}
- Text: ${aim.text}
- Status: ${aim.status.state}

**Instructions:**
1. Analyze the aim and identify 3-5 logical sub-aims that together accomplish the parent aim
2. For each sub-aim, determine if it depends on other sub-aims (create supportingConnections/supportedAims relationships)
3. Create each sub-aim using the create-aim tool
4. Link each sub-aim to the parent aim by:
   - Adding the parent aim's ID to the sub-aim's supportedAims array
   - Adding the sub-aim's ID to the parent aim's supportingConnections array (use update-aim)
5. Explain the breakdown strategy and dependency reasoning

Project path: ${projectPath}`,
              },
            },
          ],
        };
      }

      case "analyze-dependencies": {
        const aims = await trpc.aim.list.query({ projectPath });

        return {
          description: "Analyze aim dependencies and suggest improvements",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Please analyze the aim dependency graph for this project:

**Total Aims:** ${aims.length}

**Instructions:**
1. Use the aims://all?projectPath=${projectPath} resource to get all aims
2. For each aim, check its supportingConnections (children) and supportedAims (parents) relationships
3. Identify:
   - Circular dependencies (if any)
   - Aims with no dependencies that could be worked on now
   - Bottleneck aims (many aims depend on them)
   - Orphaned aims (no relationships to other aims)
4. Suggest improvements to the dependency structure
5. Recommend which aims should be prioritized based on the dependency analysis

Project path: ${projectPath}`,
              },
            },
          ],
        };
      }

      case "plan-phase": {
        const phaseId = args.phaseId as string;
        if (!phaseId) {
          throw new Error("phaseId argument is required");
        }

        const phase = await trpc.phase.get.query({ projectPath, phaseId });
        const allAims = await trpc.aim.list.query({ projectPath });

        return {
          description: `Help plan commitments for phase "${phase.name}"`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Help me plan which aims to commit to this phase:

**Phase:**
- Name: ${phase.name}
- Duration: ${new Date(phase.from).toLocaleDateString()} to ${new Date(phase.to).toLocaleDateString()}
- Current commitments: ${phase.commitments.length} aims

**Instructions:**
1. Review all available aims using aims://all?projectPath=${projectPath}
2. Consider:
   - Aim dependencies (don't commit aims before their dependencies are done)
   - Current aim statuses (prioritize 'open' aims)
   - Phase duration (is there enough time?)
   - Already committed aims in this phase
3. Suggest which aims to commit using the commit-aim-to-phase tool
4. Explain the reasoning for each suggestion

Project path: ${projectPath}
Phase ID: ${phaseId}`,
              },
            },
          ],
        };
      }

      case "review-progress": {
        const phaseId = args.phaseId as string;
        if (!phaseId) {
          throw new Error("phaseId argument is required");
        }

        const phase = await trpc.phase.get.query({ projectPath, phaseId });

        return {
          description: `Review progress for phase "${phase.name}"`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Review the progress of this phase and suggest next actions:

**Phase:**
- Name: ${phase.name}
- Duration: ${new Date(phase.from).toLocaleDateString()} to ${new Date(phase.to).toLocaleDateString()}
- Committed aims: ${phase.commitments.length}

**Instructions:**
1. Use phase://${phaseId}/aims?projectPath=${projectPath} to get all committed aims
2. Analyze the status of each aim:
   - Count: open, done, cancelled, partially, failed
   - Identify blocked aims (dependencies not met)
   - Identify aims ready to work on
3. Calculate progress percentage
4. Suggest:
   - Which aim to focus on next
   - Whether any aims should be moved to a different phase
   - Whether the phase timeline is realistic
5. Provide a concise progress report

Project path: ${projectPath}
Phase ID: ${phaseId}`,
              },
            },
          ],
        };
      }

      case "hypothesis-test": {
        const aimId = args.aimId as string;
        if (!aimId) {
          throw new Error("aimId argument is required");
        }

        const aim = await trpc.aim.get.query({ projectPath, aimId });

        return {
          description: `Structure aim "${aim.text}" as a testable hypothesis`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Help me structure this aim as a testable hypothesis with clear success criteria:

**Current Aim:**
- Text: ${aim.text}
- Status: ${aim.status.state}

**Instructions:**
1. Reformulate the aim as a hypothesis (if needed)
2. Define 3-5 concrete, measurable success criteria
3. Identify what evidence would prove/disprove the hypothesis
4. Suggest sub-aims that represent experiments or tests
5. Update the aim's text and status.comment to reflect this structure using update-aim

Use this format:
**Hypothesis:** [Clear, testable statement]
**Success Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
...

**Evidence Required:** [What data/outcomes prove success]

**Experiments:** [Sub-aims to test hypothesis]

Project path: ${projectPath}
Aim ID: ${aimId}`,
              },
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Error generating prompt: ${errorMessage}\n\nMake sure the projectPath and any required IDs are valid.`
    );
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Aimparency MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
