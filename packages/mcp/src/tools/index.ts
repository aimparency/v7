import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { BackendClient } from "../client.js";
import { TOOLS, toolsByName } from "./catalog.js";

export { verificationHintForIdea, ideaCreationConfirmationToken } from "./ideas.js";
export { resolvePhasePlacement } from "./phases.js";
export { countIdeaReferences } from "../reconcile.js";

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
