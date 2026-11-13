import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { BackendClient } from "../client.js";
import { TOOLS } from "./catalog.js";
import { reportToolActivity } from "../activity.js";

export { verificationHintForIdea, ideaCreationConfirmationToken } from "./ideas.js";
export { resolvePhasePlacement } from "./phases.js";
export { countIdeaReferences } from "../reconcile.js";

// Tools that touch this machine's files directly instead of asking the backend,
// so its access checks never see them: a server with accounts must not offer them.
const LOCAL_ONLY_TOOLS = new Set(["enable_continue_hook", "disable_continue_hook"]);

export function availableTools(withAccounts: boolean) {
  return withAccounts ? TOOLS.filter((tool) => !LOCAL_ONLY_TOOLS.has(tool.name)) : TOOLS;
}

export function registerTools(server: Server, trpcClient: BackendClient) {
  // The backend says what kind of server this is, once per session. While it
  // does not answer, the tools that bypass it stay out.
  let known: Promise<typeof TOOLS> | undefined;
  const sessionTools = () => known ??= trpcClient.auth.me.query()
    .then(({ login }) => availableTools(login === "accounts"))
    .catch(() => {
      known = undefined;
      return availableTools(true);
    });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await sessionTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const tool = (await sessionTools()).find((candidate) => candidate.name === name);
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
            text: `Error executing ${name}: ${errorMessage}\n\nPlease check that:\n1. The projectPath is the absolute path of the project, or the name of a graph on the server\n2. All UUIDs are valid and exist\n3. The backend server is running on ws://localhost:${process.env.PORT_BACKEND_WS || '3001'}`,
          },
        ],
        isError: true,
      };
    }
  });
}
