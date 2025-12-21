import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";
import { trpc } from "./client.js";

export function createMcpServer() {
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
  registerTools(server, trpc);
  registerPrompts(server, trpc);
  
  return server;
}
