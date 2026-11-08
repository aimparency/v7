import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { GraphTools, LoopDefinition } from 'agent-tools';
import { runCycle } from './cycle.js';
import type { RoleModels } from './models.js';
import { fakeClaude } from './fake-claude.js';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

/** Each model call submits the next scripted stage result. */
function submittingModel(submissions: Array<[string, unknown]>) {
  const toolSets: string[][] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      toolSets.push((options.tools ?? []).map((entry) => entry.name));
      const [toolName, input] = submissions[toolSets.length - 1] ?? ['none', {}];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: `call-${toolSets.length}`, toolName, input: JSON.stringify(input) },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }
          ] as any[]
        })
      };
    }
  });
  return { model, toolSets };
}

const idea = (id: string, state: string, children: Array<{ ideaId: string; hypothesis?: string }> = [], parents: string[] = []) => ({
  id,
  text: `idea ${id}`,
  description: '',
  tags: [],
  status: { state, comment: '', date: 0 },
  supportingConnections: children.map((child) => ({ ...child, relativePosition: [0, 0], weight: 1 })),
  supportedIdeas: parents
});

/** A graph over a fixed idea list whose backend records every write. */
function fakeGraph(ideas: any[], targetId: string, similar: any[] = []) {
  const writes: Array<[string, any]> = [];
  const byId = new Map(ideas.map((entry) => [entry.id, entry]));
  const backend = {
    idea: {
      get: { query: async ({ ideaId }: any) => byId.get(ideaId) },
      update: { mutate: async (input: any) => { writes.push(['update', input]); } },
      search: { query: async () => [] },
      createFloatingIdea: { mutate: async (input: any) => { writes.push(['create', input]); return { id: '99999999-9999-4999-8999-999999999999' }; } },
      connectIdeas: { mutate: async (input: any) => { writes.push(['connect', input]); } }
    },
    project: { getMeta: { query: async () => null } }
  };
  const graph = {
    listIdeas: async () => ideas,
    listPhases: async () => [],
    getPrioritizedIdeas: async () => [{ idea: byId.get(targetId), phase: { name: 'now' }, priority: 1, value: 1, cost: 1 }],
    getIdeaContext: async () => ({}),
    searchIdeas: async () => similar,
    backend,
    close: () => {}
  } as unknown as GraphTools;
  return { graph, writes };
}

async function cycleContext(graph: GraphTools, model: MockLanguageModelV3) {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cycle-'));
  await fs.mkdir(path.join(projectPath, '.bowman', 'runtime'), { recursive: true });
  await fs.writeFile(path.join(projectPath, '.bowman', 'runtime', 'loops.json'), '{}');
  const loop = {
    provider: 'openai-compatible', model: 'mock', baseUrl: 'http://mock', systemPrompt: 'test loop',
    associationChance: 0, worktreePath: null, capabilities: ['coding', 'experiments', 'code-intelligence']
  } as unknown as LoopDefinition;
  const spec = { provider: 'openai-compatible' as const, model: 'mock', baseUrl: 'http://mock' };
  const models = Object.fromEntries(['planner', 'executor', 'verifier', 'reflector'].map((role) => [role, { spec, model }])) as unknown as RoleModels;
  return { projectPath, instanceId: 'instance', loop, graph, signal: new AbortController().signal, models };
}

test('a leaf goes execute → verify → reflect → record, and the harness writes the status and the reflection', async () => {
  const ideas = [
    idea('parent', 'open', [{ ideaId: 'leaf', hypothesis: 'the leaf makes the parent faster' }]),
    idea('leaf', 'open', [], ['parent'])
  ];
  const { graph, writes } = fakeGraph(ideas, 'leaf');
  const { model, toolSets } = submittingModel([
    ['submit_execution', { outcome: 'done', summary: 'added cache', evidence: 'bench 2x faster', commands: ['echo bench ok'] }],
    ['submit_verdict', { verdict: 'verified', reasons: 're-ran pnpm bench' }],
    ['submit_reflections', { reflections: [{ parentId: 'parent', held: 'held', reflection: 'twice as fast' }, { parentId: 'stranger', held: 'held', reflection: 'x' }] }]
  ]);
  const context = await cycleContext(graph, model);
  await runCycle(context);

  const traceDir = path.join(context.projectPath, '.bowman', 'runtime', 'traces');
  const [traceFile] = await fs.readdir(traceDir);
  const trace = JSON.parse(await fs.readFile(path.join(traceDir, traceFile!), 'utf8'));
  assert.deepEqual(trace.stages.map((stage: any) => stage.stage), ['execute (executor)', 'verify (verifier)', 'reflect (reflector)']);
  assert.equal(trace.stages[0].toolCalls[0].name, 'submit_execution');
  assert.match(trace.stages[0].prompt, /## idea\nidea leaf/);
  assert.ok(trace.verifiedDiff, 'the trace keeps what the verifier saw');
  assert.equal(trace.statusChange.state, 'implemented');
  assert.deepEqual(trace.receipts.map((receipt: any) => [receipt.command, receipt.exitCode, receipt.outputTail]), [['echo bench ok', 0, 'bench ok']]);
  assert.match(trace.stages[1].prompt, /Receipts[\s\S]*\$ echo bench ok\n  exit 0/);
  assert.deepEqual(trace.usage, { inputTokens: 30, outputTokens: 15 });

  assert.equal(toolSets.length, 3);
  assert.ok(toolSets[0]!.includes('str_replace') && !toolSets[0]!.includes('update_idea'), 'the executor codes but never writes the graph');
  assert.ok(toolSets[1]!.includes('run_command') && !toolSets[1]!.includes('str_replace'), 'the verifier re-runs but does not edit');
  assert.deepEqual(toolSets[2], ['submit_reflections']);

  const parentUpdate = writes.find(([kind, input]) => kind === 'update' && input.ideaId === 'parent');
  assert.equal(parentUpdate?.[1].idea.supportingConnections[0].reflection, 'Held: twice as fast');
  const statusUpdate = writes.find(([kind, input]) => kind === 'update' && input.ideaId === 'leaf' && input.idea.status);
  assert.equal(statusUpdate?.[1].idea.status.state, 'implemented');
  assert.match(statusUpdate?.[1].idea.status.comment, /bench 2x faster[\s\S]*re-ran pnpm bench/);
});

test('a failed verdict leaves the idea open with the objection, and nothing is reflected', async () => {
  const { graph, writes } = fakeGraph([idea('leaf', 'open')], 'leaf');
  const { model, toolSets } = submittingModel([
    ['submit_execution', { outcome: 'done', summary: 'added cache', evidence: 'bench faster', commands: [] }],
    ['submit_verdict', { verdict: 'failed', reasons: 'no benchmark in the diff' }]
  ]);
  await runCycle(await cycleContext(graph, model));
  assert.equal(toolSets.length, 2);
  const statusUpdate = writes.find(([kind]) => kind === 'update');
  assert.equal(statusUpdate?.[1].idea.status.state, 'open');
  assert.match(statusUpdate?.[1].idea.status.comment, /no benchmark in the diff/);
});

test('a container is decomposed: new children are created under it, a shown similar idea is linked, an ancestor is not', async () => {
  const ideas = [
    idea('root', 'open', [{ ideaId: 'container' }]),
    idea('container', 'open', [{ ideaId: 'running-child' }], ['root']),
    idea('running-child', 'partially', [], ['container']),
    idea('similar', 'open')
  ];
  const { graph, writes } = fakeGraph(ideas, 'container', [{ id: 'similar' }, { id: 'root' }]);
  const child = (text: string, existingIdeaId?: string) => ({ text, description: 'done when tested', hypothesis: 'it helps', weight: 1, cost: 2, ...(existingIdeaId ? { existingIdeaId } : {}) });
  const { model, toolSets } = submittingModel([
    ['submit_decomposition', { children: [child('new step'), child('reuse', 'similar'), child('loop back', 'root')], rationale: 'covers it' }]
  ]);
  await runCycle(await cycleContext(graph, model));

  assert.equal(toolSets.length, 1, 'decomposition ends the cycle');
  const created = writes.filter(([kind]) => kind === 'create').map(([, input]) => input.idea.text);
  assert.deepEqual(created, ['new step', 'loop back'], 'an ancestor is never linked as a child; that child is created instead');
  const connect = writes.find(([kind]) => kind === 'connect');
  assert.equal(connect?.[1].parentIdeaId, 'container');
  const link = writes.find(([kind, input]) => kind === 'update' && input.ideaId === 'container');
  assert.ok(link?.[1].idea.supportingConnections.some((connection: any) => connection.ideaId === 'similar'));
});

test('a claimed command that fails when the harness re-runs it overrules a verified verdict', async () => {
  const { graph, writes } = fakeGraph([idea('leaf', 'open')], 'leaf');
  const { model, toolSets } = submittingModel([
    ['submit_execution', { outcome: 'done', summary: 'fixed', evidence: 'tests pass', commands: ['node -e "process.exit(3)"'] }],
    ['submit_verdict', { verdict: 'verified', reasons: 'looks right' }]
  ]);
  await runCycle(await cycleContext(graph, model));
  assert.equal(toolSets.length, 2, 'no reflection after an overruled verdict');
  const statusUpdate = writes.find(([kind]) => kind === 'update');
  assert.equal(statusUpdate?.[1].idea.status.state, 'open');
  assert.match(statusUpdate?.[1].idea.status.comment, /Overruled by the harness: re-run of the claimed command `node -e "process.exit\(3\)"` exited 3/);
});

test('.bowman/harness.json steers the cycle: children land as ai-proposition, capped, and the trace names the config version', async () => {
  const ideas = [idea('container', 'open', [{ ideaId: 'running-child' }]), idea('running-child', 'partially', [], ['container'])];
  const { graph, writes } = fakeGraph(ideas, 'container');
  const child = (text: string) => ({ text, description: 'done when tested', hypothesis: 'it helps', weight: 1, cost: 2 });
  const { model } = submittingModel([['submit_decomposition', { children: [child('first'), child('second')], rationale: 'covers it' }]]);
  const context = await cycleContext(graph, model);
  await fs.writeFile(path.join(context.projectPath, '.bowman', 'harness.json'), JSON.stringify({ decomposition: { maxChildren: 1, landingState: 'ai-proposition' } }));
  await runCycle(context);

  const created = writes.filter(([kind]) => kind === 'create').map(([, input]) => [input.idea.text, input.idea.status.state]);
  assert.deepEqual(created, [['first', 'ai-proposition']]);
  const traceDir = path.join(context.projectPath, '.bowman', 'runtime', 'traces');
  const [traceFile] = await fs.readdir(traceDir);
  const trace = JSON.parse(await fs.readFile(path.join(traceDir, traceFile!), 'utf8'));
  assert.match(trace.harnessConfig.version, /^[0-9a-f]{12}$/);
  assert.equal(trace.harnessConfig.config.decomposition.landingState, 'ai-proposition');
});

async function readOnlyTrace(projectPath: string) {
  const traceDir = path.join(projectPath, '.bowman', 'runtime', 'traces');
  const files = await fs.readdir(traceDir).catch(() => [] as string[]);
  return files.length === 1 ? JSON.parse(await fs.readFile(path.join(traceDir, files[0]!), 'utf8')) : files.length;
}

test('budgets: a priced cycle records its cost, the token budget stops before the next stage, the daily budget skips the cycle', async () => {
  const leaf = () => fakeGraph([idea('leaf', 'open')], 'leaf');
  const executionDone = ['submit_execution', { outcome: 'done', summary: 'fixed', evidence: 'ok', commands: [] }] as [string, unknown];
  // Each mock call uses 10 input and 5 output tokens.
  const prices = { mock: { inputPerMTok: 1_000_000, outputPerMTok: 2_000_000 } };

  const priced = leaf();
  const pricedContext = await cycleContext(priced.graph, submittingModel([executionDone, ['submit_verdict', { verdict: 'failed', reasons: 'no' }]]).model);
  await fs.writeFile(path.join(pricedContext.projectPath, '.bowman', 'harness.json'), JSON.stringify({ prices }));
  await runCycle(pricedContext);
  assert.equal((await readOnlyTrace(pricedContext.projectPath)).costUsd, 40, 'two stages at $10 input + $10 output each');

  const limited = leaf();
  const scripted = submittingModel([executionDone, ['submit_verdict', { verdict: 'verified', reasons: 'ok' }]]);
  const limitedContext = await cycleContext(limited.graph, scripted.model);
  await fs.writeFile(path.join(limitedContext.projectPath, '.bowman', 'harness.json'), JSON.stringify({ budgets: { maxTokensPerCycle: 15 } }));
  await runCycle(limitedContext);
  assert.equal(scripted.toolSets.length, 1, 'verify never started');
  const limitedTrace = await readOnlyTrace(limitedContext.projectPath);
  assert.ok(limitedTrace.notes.includes('token budget of 15 reached before verify'));
  assert.equal(limitedTrace.costUsd, null, 'no price configured');
  assert.equal(limited.writes.length, 0, 'an unverified idea keeps its status');

  const broke = leaf();
  const brokeModel = submittingModel([executionDone]);
  const brokeContext = await cycleContext(broke.graph, brokeModel.model);
  await fs.writeFile(path.join(brokeContext.projectPath, '.bowman', 'harness.json'), JSON.stringify({ budgets: { maxUsdPerDay: 1 } }));
  const traceDir = path.join(brokeContext.projectPath, '.bowman', 'runtime', 'traces');
  await fs.mkdir(traceDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(traceDir, `${today}T00-00-00-000Z-earlier0.json`), JSON.stringify({ costUsd: 1.5 }));
  await runCycle(brokeContext);
  assert.equal(brokeModel.toolSets.length, 0, 'no model call once the daily budget is spent');
  assert.equal((await fs.readdir(traceDir)).length, 1, 'no new trace');
});

test('with the claude-code backend, Claude Code executes and the harness still verifies, writes the graph and adds up the cost', async () => {
  const fake = await fakeClaude({
    is_error: false,
    structured_output: { outcome: 'done', summary: 'cached it', evidence: 'echo ok printed ok', commands: ['echo ok'] },
    total_cost_usd: 0.3,
    usage: { input_tokens: 100, output_tokens: 20 }
  });
  const { graph, writes } = fakeGraph([idea('leaf', 'open')], 'leaf');
  const { model, toolSets } = submittingModel([['submit_verdict', { verdict: 'verified', reasons: 'receipt exit 0' }]]);
  const context = await cycleContext(graph, model);
  await fs.writeFile(path.join(context.projectPath, '.bowman', 'harness.json'), JSON.stringify({
    executor: { backend: 'claude-code', claudeCode: { command: fake.command } },
    prices: { mock: { inputPerMTok: 0, outputPerMTok: 0 } }
  }));
  await runCycle(context);

  assert.equal(toolSets.length, 1, 'only the verifier ran on the harness model');
  assert.ok(toolSets[0]!.includes('submit_verdict'));
  assert.equal(writes.find(([kind]) => kind === 'update')?.[1].idea.status.state, 'implemented');
  const trace = await readOnlyTrace(context.projectPath);
  assert.equal(trace.stages[0].stage, 'execute (claude-code)');
  assert.equal(trace.costUsd, 0.3);
  assert.equal(trace.receipts[0].exitCode, 0);
});
