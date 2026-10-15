import { test } from 'node:test';
import assert from 'node:assert';
import { toolsByName } from 'mcp/tool-catalog';
import type { GraphTools } from 'agent-tools';
import { graphCatalogTools, LOOP_GRAPH_TOOL_NAMES } from './graph-catalog-tools.js';

test('loop graph tools are the MCP tools, with projectPath filled in instead of asked for', async () => {
  const calls: unknown[] = [];
  const backend = { idea: { commitToPhase: { mutate: async (input: unknown) => { calls.push(input); } } } };
  const tools = graphCatalogTools({ backend } as unknown as GraphTools, '/work/project/.bowman');

  assert.deepEqual(Object.keys(tools), [...LOOP_GRAPH_TOOL_NAMES]);
  for (const name of LOOP_GRAPH_TOOL_NAMES) {
    const schema = (tools[name] as any).inputSchema.jsonSchema;
    assert.equal(tools[name]!.description, toolsByName.get(name)!.description, name);
    assert.equal(schema.properties.projectPath, undefined, name);
    assert.ok(!(schema.required ?? []).includes('projectPath'), name);
  }

  const ideaId = '11111111-1111-4111-8111-111111111111';
  const phaseId = '22222222-2222-4222-8222-222222222222';
  await (tools.commit_idea_to_phase as any).execute({ ideaId, phaseId }, {});
  assert.equal((calls[0] as { projectPath: string }).projectPath, '/work/project');
});

test('a failing handler answers the model with the error instead of throwing', async () => {
  const backend = { idea: { commitToPhase: { mutate: async () => { throw new Error('phase is gone'); } } } };
  const tools = graphCatalogTools({ backend } as unknown as GraphTools, '/work/project');
  const answer = await (tools.commit_idea_to_phase as any).execute({ ideaId: 'a', phaseId: 'b' }, {});
  assert.match(answer, /Error executing commit_idea_to_phase: .*phase is gone/);
});
