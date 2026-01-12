import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { createMcpServer } from "./factory.js";

const port = process.env.PORT_MCP || 3005;
const app = express();

app.use(cors());

// Store transports by session ID
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  console.log(`New SSE connection`);
  const server = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  
  await server.connect(transport);
  
  transports.set(transport.sessionId, transport);
  
  res.on('close', () => {
    console.log(`SSE connection closed: ${transport.sessionId}`);
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
  console.log(`Aimparency MCP Server running on SSE/HTTP at http://localhost:${port}/sse`);
});
