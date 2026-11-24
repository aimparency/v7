import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts.js";
import type { BackendClient } from "./client.js";

/** `space`: the one space this session is for (its tools then need no projectPath). */
export function createMcpServer(trpc: BackendClient, space?: string) {
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

  // Register handlers
  registerResources(server, trpc);
  registerTools(server, trpc, space);
  registerPrompts(server, trpc);
  
  return server;
}
