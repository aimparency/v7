import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendClient } from "../client.js";

// One MCP tool: what the agent sees (name, description, inputSchema) next to
// the code that runs it.
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  handler: (args: Record<string, unknown>, trpcClient: BackendClient) => Promise<CallToolResult>;
};
