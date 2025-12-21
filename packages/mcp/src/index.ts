#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";
import { trpc } from "./client.js";
import express from "express";
import cors from "cors";

function createServer() {
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

// Start server
async function main() {
  const port = process.env.MCP_PORT;

  if (port) {
    // SSE Mode
    const app = express();
    app.use(cors());
    
    // Store transports by session ID
    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      console.error(`New SSE connection`);
      const server = createServer();
      const transport = new SSEServerTransport("/messages", res);
      
      await server.connect(transport);
      
      transports.set(transport.sessionId, transport);
      
      res.on('close', () => {
        console.error(`SSE connection closed: ${transport.sessionId}`);
        server.close();
        transports.delete(transport.sessionId);
      });
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      
      if (!transport) {
        res.status(404).send("Session not found");
        return;
      }
      
      await transport.handlePostMessage(req, res);
    });

    app.listen(port, () => {
      console.error(`Aimparency MCP Server running on SSE/HTTP at http://localhost:${port}/sse`);
    });

  } else {
    // Stdio Mode (Default)
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Aimparency MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});