import { jsonSchema, tool } from 'ai';
import { toolsByName } from 'mcp/tool-catalog';
import { toProjectRoot } from 'shared';
import type { GraphTools } from 'agent-tools';

// The space tools the loop model gets are the MCP tools themselves (same names,
// wording, schemas and handlers over the backend), so loop agents and MCP
// agents cannot drift apart. The worker fills in the space; the model never
// sees it.
export const LOOP_GRAPH_TOOL_NAMES = [
  'get_prioritized_ideas',
  'get_idea_context',
  'search_ideas_semantic',
  'space_hygiene',
  'create_idea',
  'update_idea',
  'commit_idea_to_phase'
] as const;

type ToolDefaults = Partial<Record<(typeof LOOP_GRAPH_TOOL_NAMES)[number], Record<string, unknown>>>;

/** `defaults`: arguments a tool gets unless the model passes them, e.g. the instance's target phase. */
export function graphCatalogTools(graph: GraphTools, projectPath: string, defaults: ToolDefaults = {}) {
  const projectRoot = toProjectRoot(projectPath);
  return Object.fromEntries(LOOP_GRAPH_TOOL_NAMES.map((name) => {
    const definition = toolsByName.get(name);
    if (!definition) throw new Error(`The MCP tool catalog has no ${name} tool.`);
    const { space: _filledIn, ...properties } = definition.inputSchema.properties ?? {};
    const required = (definition.inputSchema.required ?? []).filter((key) => key !== 'space');
    return [name, tool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>({ ...definition.inputSchema, properties, required }),
      execute: async (args) => {
        // Like the MCP server: a failure is an answer the model can act on.
        try {
          const result = await definition.handler({ ...defaults[name], ...args, space: projectRoot }, graph.backend);
          return result.content.map((part) => part.type === 'text' ? part.text : JSON.stringify(part)).join('\n');
        } catch (error) {
          return `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    })];
  }));
}
