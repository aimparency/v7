#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./factory.js";
import { createBackendClient } from "./client.js";

const backend = createBackendClient(process.env.AIMPARENCY_TOKEN);

async function main() {
  const server = createMcpServer(backend.trpc);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Aimparency MCP Server running on stdio");
}

// Cleanup handler to close WebSocket and exit gracefully
function cleanup() {
  backend.close();
  process.exit(0);
}

// Listen for stdin close (when the agent exits)
process.stdin.on('close', cleanup);

// Listen for termination signals
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
