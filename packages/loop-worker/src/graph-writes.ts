import { toolsByName } from 'mcp/tool-catalog';
import { toProjectRoot } from 'shared';
import type { GraphTools } from 'agent-tools';
import { formatReflection, type Decomposition, type Reflection, type StatusChange } from './stages.js';

// The harness applies stage results to the graph itself, through the same MCP
// handlers agents use, so harness writes and agent writes share one semantics.

async function callGraphTool(graph: GraphTools, projectPath: string, name: string, args: Record<string, unknown>): Promise<string> {
  const definition = toolsByName.get(name);
  if (!definition) throw new Error(`The MCP tool catalog has no ${name} tool.`);
  const result = await definition.handler({ ...args, projectPath: toProjectRoot(projectPath) }, graph.backend);
  return result.content.map((part) => part.type === 'text' ? part.text : JSON.stringify(part)).join('\n');
}

export type AppliedDecomposition = { created: string[]; linked: string[] };

/**
 * Creates the proposed children under the parent, or links an existing idea
 * where the model named one. Only ids in `linkableIds` (the similar ideas the
 * model was shown, minus the parent and its ancestors) can be linked.
 */
export async function applyDecomposition(
  graph: GraphTools,
  projectPath: string,
  parentId: string,
  decomposition: Decomposition,
  linkableIds: Set<string>,
  landingState: string
): Promise<AppliedDecomposition> {
  const applied: AppliedDecomposition = { created: [], linked: [] };
  for (const child of decomposition.children) {
    const edge = { weight: child.weight, hypothesis: child.hypothesis };
    if (child.existingIdeaId && linkableIds.has(child.existingIdeaId)) {
      await callGraphTool(graph, projectPath, 'update_idea', {
        ideaId: parentId,
        addSupportingConnections: [{ ideaId: child.existingIdeaId, ...edge }]
      });
      applied.linked.push(child.existingIdeaId);
      continue;
    }
    const fields = {
      text: child.text,
      description: child.description,
      cost: child.cost,
      tags: ['harness'],
      status: { state: landingState, comment: 'Proposed by the harness decomposition stage.', date: Date.now() },
      supportedIdeas: [{ ideaId: parentId, ...edge }]
    };
    const review = JSON.parse(await callGraphTool(graph, projectPath, 'create_idea', fields)) as { confirmationToken: string };
    const created = await callGraphTool(graph, projectPath, 'create_idea', { ...fields, confirmationToken: review.confirmationToken });
    const id = created.match(/Created idea with ID: ([0-9a-f-]{36})/)?.[1];
    if (!id) throw new Error(`create_idea did not report an id: ${created}`);
    applied.created.push(id);
  }
  return applied;
}

export async function applyStatus(graph: GraphTools, projectPath: string, ideaId: string, change: StatusChange) {
  await callGraphTool(graph, projectPath, 'update_idea', { ideaId, status: change });
}

/** Writes one reflection per parent edge; reflections on non-parents are dropped. */
export async function applyReflections(
  graph: GraphTools,
  projectPath: string,
  ideaId: string,
  reflection: Reflection,
  parentIds: Set<string>
): Promise<number> {
  const entries = reflection.reflections.filter((entry) => parentIds.has(entry.parentId));
  if (entries.length === 0) return 0;
  await callGraphTool(graph, projectPath, 'update_idea', {
    ideaId,
    addSupportedIdeas: entries.map((entry) => ({ ideaId: entry.parentId, reflection: formatReflection(entry) }))
  });
  return entries.length;
}
