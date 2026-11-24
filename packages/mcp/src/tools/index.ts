import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { BackendClient } from "../client.js";
import { TOOLS } from "./catalog.js";
import type { ToolDefinition } from "./types.js";
import { reportToolActivity } from "../activity.js";
import { SPACE_DIRECTION } from "../constants.js";
import { expandIdPrefixes, IdPrefixError } from "./id-prefixes.js";

export { verificationHintForIdea, ideaCreationConfirmationToken } from "./ideas.js";
export { resolvePhasePlacement } from "./phases.js";
export { countIdeaReferences } from "../reconcile.js";

// Tools about this machine's files (directly, or through a backend procedure
// that only a server without accounts answers): a server with accounts does not offer them.
const LOCAL_ONLY_TOOLS = new Set(["enable_continue_hook", "disable_continue_hook", "find_spaces_on_disk"]);

export function availableTools(withAccounts: boolean) {
  return withAccounts ? TOOLS.filter((tool) => !LOCAL_ONLY_TOOLS.has(tool.name)) : TOOLS;
}

// A session with a space of its own (connected through the space's address,
// <host>/spaces/<slug>/mcp/sse, or started in a repo with a .bowman) works on
// that space unless a call names another: its tools take `space` as optional.
export function toolForSpace(tool: ToolDefinition, space: string | undefined): Pick<ToolDefinition, "name" | "description" | "inputSchema"> {
  const { name, description, inputSchema } = tool;
  if (!space || !inputSchema.required?.includes("space")) return { name, description, inputSchema };
  return {
    name,
    description,
    inputSchema: {
      ...inputSchema,
      required: inputSchema.required.filter((property) => property !== "space"),
      properties: { ...inputSchema.properties, space: { type: "string", description: `Leave out to work on this session's space "${space}"; name another space to work there. ${SPACE_DIRECTION}` } },
    },
  };
}

// The space a call works on: the one it names, else the session's.
export function argumentsWithSpace(given: Record<string, unknown> | undefined, sessionSpace: string | undefined) {
  if (!given || given.space !== undefined || sessionSpace === undefined) return given;
  return { ...given, space: sessionSpace };
}

export function registerTools(server: Server, trpcClient: BackendClient, space?: string) {
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
    tools: (await sessionTools()).map((tool) => toolForSpace(tool, space)),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = argumentsWithSpace(request.params.arguments, space);
    try {
      const tool = (await sessionTools()).find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (!args) throw new Error("Arguments are required for tool calls");
      // Ideas and phases may be named by the beginning of their id.
      const expanded = await expandIdPrefixes(args, trpcClient);
      const result = await tool.handler(expanded, trpcClient);
      reportToolActivity(trpcClient, name, expanded, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof IdPrefixError) return { content: [{ type: "text", text: `Error executing ${name}: ${errorMessage}` }], isError: true };
      return {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${errorMessage}\n\nPlease check that:\n1. "space" is the absolute path of the project, or the name of a space on the server\n2. All ids exist (the full UUID, or a beginning of it that only one id has)\n3. The backend server is running on ws://localhost:${process.env.PORT_BACKEND_WS || '3001'}`,
          },
        ],
        isError: true,
      };
    }
  });
}
