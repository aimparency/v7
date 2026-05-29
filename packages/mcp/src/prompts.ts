import { ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export function registerPrompts(server: Server, _caller: any) {
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: [] };
  });
}
