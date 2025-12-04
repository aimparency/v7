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
const PROJECT_PATH_DESCRIPTION = "Absolute path to the project directory (usually ends with .bowman)";

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
    description: `MCP server for Aimparency project management. IMPORTANT: All resources and tools require 'projectPath' parameter - ${PROJECT_PATH_DESCRIPTION}. For resources, pass as query parameter: aims://all?projectPath=/absolute/path. For tools, pass as a property in the arguments object. Available Aim States: ${AIM_STATES.join(", ")}`,
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

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "aim://{uuid}?projectPath=/absolute/path",
        name: "Single aim",
        description: "Get a specific aim's text, status, and relationships. Replace {uuid} with actual aim ID.",
        mimeType: "application/json",
      },
      {
        uri: "aim://{uuid}/incoming?projectPath=/absolute/path",
        name: "Aim dependencies",
        description: "Get all aims that this aim depends on (prerequisites)",
        mimeType: "application/json",
      },
      {
        uri: "aim://{uuid}/outgoing?projectPath=/absolute/path",
        name: "Dependent aims",
        description: "Get all aims that depend on this aim (blocked by this aim)",
        mimeType: "application/json",
      },
      {
        uri: "aims://all?projectPath=/absolute/path",
        name: "All aims",
        description: "List all aims in the project with their full details",
        mimeType: "application/json",
      },
      {
        uri: "phase://{uuid}?projectPath=/absolute/path",
        name: "Single phase",
        description: "Get a phase's name, date range, parent, and committed aims. Replace {uuid} with actual phase ID.",
        mimeType: "application/json",
      },
      {
        uri: "phase://{uuid}/aims?projectPath=/absolute/path",
        name: "Phase aims",
        description: "Get full details of all aims committed to this phase",
        mimeType: "application/json",
      },
      {
        uri: "phases://all?projectPath=/absolute/path",
        name: "All phases",
        description: "List all phases in the project (root and sub-phases)",
        mimeType: "application/json",
      },
      {
        uri: "phases://{parent-uuid}/children?projectPath=/absolute/path",
        name: "Sub-phases",
        description: "List all child phases of a specific parent phase",
        mimeType: "application/json",
      },
      {
        uri: "project://meta?projectPath=/absolute/path",
        name: "Project info",
        description: "Get project name and color",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const parsed = parseResourceUri(uri);

  try {
    // Extract projectPath from URI query parameter (e.g., aim://uuid?projectPath=/path/to/project)
    const url = new URL(uri, "http://dummy");
    const projectPath = url.searchParams.get("projectPath");

    if (!projectPath) {
      throw new Error("projectPath query parameter is required (e.g., aim://uuid?projectPath=/path/to/project)");
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

      if (parsed.subpath === "incoming") {
        const incomingAims = await Promise.all(
          aim.incoming.map((id) => trpc.aim.get.query({ projectPath, aimId: id }))
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(incomingAims, null, 2),
            },
          ],
        };
      }

      if (parsed.subpath === "outgoing") {
        const outgoingAims = await Promise.all(
          aim.outgoing.map((id) => trpc.aim.get.query({ projectPath, aimId: id }))
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(outgoingAims, null, 2),
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
          text: `Error reading resource: ${errorMessage}\n\nMake sure to include projectPath as a query parameter, e.g.:\naim://uuid?projectPath=/path/to/project`,
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
        name: "list-aims",
        description: "List all aims in the project",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: PROJECT_PATH_TOOL_PROPERTY,
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
          },
          required: ["projectPath", "query"],
        },
      },
      {
        name: "list-phases",
        description: "List all phases in the project",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: PROJECT_PATH_TOOL_PROPERTY,
            parentPhaseId: { type: ["string", "null"], description: "Optional parent phase ID" },
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
            incoming: {
              type: "array",
              items: { type: "string" },
              description: "UUIDs of aims this aim depends on",
            },
            outgoing: {
              type: "array",
              items: { type: "string" },
              description: "UUIDs of aims that depend on this aim",
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
            incoming: {
              type: "array",
              items: { type: "string" },
            },
            outgoing: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["projectPath", "aimId"],
        },
      },
      {
        name: "delete-aim",
        description: "Delete an aim permanently. Automatically removes it from all phases it's committed to.",
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
      case "list-aims": {
        const aims = await trpc.aim.list.query({
          projectPath: args.projectPath as string,
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
            status: (args.status as any) || {
              state: "open",
              comment: "",
              date: Date.now(),
            },
          },
        });

        // Handle incoming connections (parents)
        const incoming = (args.incoming as string[]) || [];
        for (const parentId of incoming) {
          await trpc.aim.connectAims.mutate({
            projectPath: args.projectPath as string,
            parentAimId: parentId,
            childAimId: result.id,
          });
        }

        // Handle outgoing connections (children)
        const outgoing = (args.outgoing as string[]) || [];
        for (const childId of outgoing) {
          await trpc.aim.connectAims.mutate({
            projectPath: args.projectPath as string,
            parentAimId: result.id,
            childAimId: childId,
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
        if (args.status) updateData.status = args.status;
        if (args.incoming) updateData.incoming = args.incoming;
        if (args.outgoing) updateData.outgoing = args.outgoing;

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
2. For each sub-aim, determine if it depends on other sub-aims (create incoming/outgoing relationships)
3. Create each sub-aim using the create-aim tool
4. Link each sub-aim to the parent aim by:
   - Adding the parent aim's ID to the sub-aim's outgoing array
   - Adding the sub-aim's ID to the parent aim's incoming array (use update-aim)
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
2. For each aim, check its incoming and outgoing relationships
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