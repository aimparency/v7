import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { BackendClient } from "../client.js";
import { TOOLS } from "./catalog.js";
import { reportToolActivity } from "../activity.js";

export { verificationHintForIdea, ideaCreationConfirmationToken } from "./ideas.js";
export { resolvePhasePlacement } from "./phases.js";
export { countIdeaReferences } from "../reconcile.js";

// Tools that touch this machine's files directly instead of asking the backend,
// so its access checks never see them: a hosted instance must not offer them.
const LOCAL_ONLY_TOOLS = new Set(["enable_continue_hook", "disable_continue_hook"]);

export function availableTools(hosted = process.env.AIMPARENCY_HOSTED === "true") {
  return hosted ? TOOLS.filter((tool) => !LOCAL_ONLY_TOOLS.has(tool.name)) : TOOLS;
}

export function registerTools(server: Server, trpcClient: BackendClient) {
  const tools = availableTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (!args) throw new Error("Arguments are required for tool calls");
      const result = await tool.handler(args, trpcClient);
      reportToolActivity(trpcClient, name, args, result);
      return result;
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
