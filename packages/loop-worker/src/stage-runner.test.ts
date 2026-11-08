import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { jsonSchema, simulateReadableStream, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LoopDefinition } from 'agent-tools';
import { runStage } from './stage-runner.js';
import { verificationSchema } from './stages.js';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const finish = (unified: 'stop' | 'tool-calls') => ({ type: 'finish' as const, finishReason: { unified, raw: undefined }, usage });
const toolCall = (toolName: string, input: unknown) => ({ type: 'tool-call' as const, toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) });
const text = (delta: string) => [
  { type: 'text-start' as const, id: 't' },
  { type: 'text-delta' as const, id: 't', delta },
  { type: 'text-end' as const, id: 't' }
];

/** A model that answers each call with the next scripted list of stream parts. */
function scriptedModel(turns: unknown[][]) {
  const calls: any[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options);
      const parts = turns[calls.length - 1] ?? [...text('nothing left'), finish('stop')];
      return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...parts] as any[] }) };
    }
  });
  return { model, calls };
}

async function stageSpec(model: MockLanguageModelV3, tools: Record<string, any> = {}) {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-runner-'));
  await fs.mkdir(path.join(projectPath, '.bowman', 'runtime'), { recursive: true });
  await fs.writeFile(path.join(projectPath, '.bowman', 'runtime', 'loops.json'), '{}');
  return {
    stage: 'verify',
    model,
    loop: { provider: 'openai-compatible', model: 'mock', baseUrl: 'http://mock' } as LoopDefinition,
    system: 'system',
    prompt: 'prompt',
    tools,
    submit: { name: 'submit_verdict', description: 'Submit the verdict.', schema: verificationSchema },
    maxSteps: 5,
    projectPath,
    instanceId: 'instance',
    signal: new AbortController().signal
  };
}

test('a stage runs tools until the submit call and returns its validated input with summed usage', async () => {
  const reads: string[] = [];
  const readFile = tool({
    description: 'read',
    inputSchema: jsonSchema<{ path: string }>({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }),
    execute: async ({ path: file }) => { reads.push(file); return 'file content'; }
  });
  const { model, calls } = scriptedModel([
    [toolCall('read_file', { path: 'a.ts' }), finish('tool-calls')],
    [toolCall('submit_verdict', { verdict: 'verified', reasons: 'tests pass' }), finish('tool-calls')],
    [...text('should never be asked'), finish('stop')]
  ]);
  const run = await runStage(await stageSpec(model, { read_file: readFile }));
  assert.deepEqual(run.result, { verdict: 'verified', reasons: 'tests pass' });
  assert.deepEqual(reads, ['a.ts']);
  assert.equal(calls.length, 2, 'the submit call ends the stage');
  assert.deepEqual(run.usage, { inputTokens: 20, outputTokens: 10 });
});

test('a model that stops without submitting gets one turn with only the submit tool', async () => {
  const { model, calls } = scriptedModel([
    [...text('I think it works.'), finish('stop')],
    [toolCall('submit_verdict', { verdict: 'unverifiable', reasons: 'no tests' }), finish('tool-calls')]
  ]);
  const run = await runStage(await stageSpec(model));
  assert.deepEqual(run.result, { verdict: 'unverifiable', reasons: 'no tests' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].tools.map((entry: { name: string }) => entry.name), ['submit_verdict']);
  assert.equal(calls[1].toolChoice.type, 'required');
});

test('an invalid submission is not a result', async () => {
  const { model } = scriptedModel([
    [toolCall('submit_verdict', { verdict: 'probably', reasons: 'looks fine' }), finish('tool-calls')],
    [...text('done'), finish('stop')],
    [...text('still nothing'), finish('stop')]
  ]);
  const run = await runStage(await stageSpec(model));
  assert.equal(run.result, null);
});
