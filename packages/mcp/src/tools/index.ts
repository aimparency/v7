import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { BackendClient } from "../client.js";
import type { ToolDefinition } from "./types.js";
import { navigationTools } from "./navigation.js";
import { ideaTools } from "./ideas.js";
import { phaseTools } from "./phases.js";
import { repoTools } from "./repos.js";
import { graphHealthTools } from "./graph-health.js";
import { hookTools } from "./hooks.js";

export { verificationHintForIdea, ideaCreationConfirmationToken } from "./ideas.js";
export { resolvePhasePlacement } from "./phases.js";
export { countIdeaReferences } from "../reconcile.js";

// Listing order is what an agent reads first: the work loop, then the graph.
const TOOLS: ToolDefinition[] = [
  ...navigationTools,
  ...ideaTools,
  ...phaseTools,
  ...repoTools,
  ...graphHealthTools,
  ...hookTools,
];
const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function registerTools(server: Server, trpcClient: BackendClient) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const tool = toolsByName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (!args) throw new Error("Arguments are required for tool calls");
      return await tool.handler(args, trpcClient);
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
