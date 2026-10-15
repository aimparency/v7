// Every agent graph tool, defined once: what the agent sees (name,
// description, input schema) next to the handler that runs it over the backend.
// The MCP server lists these (tools/index.ts) and the loop worker offers a
// subset to its model, so both kinds of agent get the same tools.
// No MCP SDK at runtime here: the loop worker imports this module.
import type { ToolDefinition } from "./types.js";
import { navigationTools } from "./navigation.js";
import { ideaTools } from "./ideas.js";
import { phaseTools } from "./phases.js";
import { repoTools } from "./repos.js";
import { graphHealthTools } from "./graph-health.js";
import { hookTools } from "./hooks.js";

// Listing order is what an agent reads first: the work loop, then the graph.
export const TOOLS: ToolDefinition[] = [
  ...navigationTools,
  ...ideaTools,
  ...phaseTools,
  ...repoTools,
  ...graphHealthTools,
  ...hookTools,
];
export const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));
