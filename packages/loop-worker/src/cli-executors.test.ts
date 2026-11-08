import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { harnessConfigSchema } from 'shared/harness-config';
import { parseCodexUsage, runClaudeCodeExecutor, runCodexExecutor } from './cli-executors.js';
import { fakeClaude, fakeCodex } from './fake-cli.js';

const defaults = harnessConfigSchema.parse({}).executor.claudeCode;

test('Claude Code runs headless without MCP or project hooks, and its structured output is the execution result', async () => {
  const execution = { outcome: 'done', summary: 'fixed it', evidence: 'tests 4/4', commands: ['pnpm test'] };
  const fake = await fakeClaude({
    is_error: false,
    result: 'done',
    structured_output: execution,
    total_cost_usd: 0.42,
    usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }
  });
  const workdir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workdir-')));
  const run = await runClaudeCodeExecutor({
    executionPath: workdir,
    system: 'harness system',
    prompt: 'the compiled context',
    config: { ...defaults, command: fake.command, model: 'sonnet', maxBudgetUsd: 1.5 },
    signal: new AbortController().signal
  });

  assert.deepEqual(run.result, execution);
  assert.equal(run.costUsd, 0.42);
  assert.equal(run.trace.costUsd, 0.42);
  assert.deepEqual(run.usage, { inputTokens: 1110, outputTokens: 50 });
  const { argv, allowStop, cwd } = await fake.recorded();
  assert.equal(cwd, workdir);
  assert.equal(allowStop, '1', 'the continuation hook must let it stop');
  assert.equal(argv[argv.indexOf('-p') + 1], 'the compiled context');
  assert.ok(argv.includes('--strict-mcp-config'));
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'user');
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '1.5');
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
  assert.match(argv[argv.indexOf('--json-schema') + 1]!, /"outcome"/);
});

test('an error, invalid output or a missing binary is no result, with the reason in the trace', async () => {
  const run = (command: string) => runClaudeCodeExecutor({
    executionPath: os.tmpdir(), system: '', prompt: '', config: { ...defaults, command }, signal: new AbortController().signal
  });
  const errored = await run((await fakeClaude({ is_error: true, subtype: 'error_max_budget_usd', result: 'budget' })).command);
  assert.equal(errored.result, null);
  assert.match(errored.trace.text, /error_max_budget_usd/);
  const invalid = await run((await fakeClaude({ is_error: false, structured_output: { outcome: 'maybe' } })).command);
  assert.equal(invalid.result, null);
  assert.match(invalid.trace.text, /no valid structured result/);
  const missing = await run('/nonexistent/claude');
  assert.equal(missing.result, null);
  assert.match(missing.trace.text, /without JSON output/);
});

const codexDefaults = harnessConfigSchema.parse({}).executor.codex;

test('Codex runs sandboxed without user config; the schema-shaped last message is the result and usage comes from turn events', async () => {
  const execution = { outcome: 'done', summary: 'patched', evidence: 'vitest 3/3', commands: ['npx vitest run'] };
  const fake = await fakeCodex(execution, [
    { type: 'thread.started' },
    { type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 90 } },
    { type: 'turn.completed', usage: { input_tokens: 300, output_tokens: 10 } }
  ]);
  const workdir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workdir-')));
  const run = await runCodexExecutor({
    executionPath: workdir, system: 'harness system', prompt: 'the compiled context',
    config: { ...codexDefaults, command: fake.command, model: 'gpt-5.5-codex' }, signal: new AbortController().signal
  });

  assert.deepEqual(run.result, execution);
  assert.deepEqual(run.usage, { inputTokens: 1500, outputTokens: 100 });
  assert.equal(run.trace.costUsd, undefined, 'priced later from harness.json');
  assert.equal(run.trace.model.model, 'gpt-5.5-codex');
  const { argv, allowStop, cwd } = await fake.recorded();
  assert.equal(cwd, workdir);
  assert.equal(allowStop, '1');
  assert.equal(argv[0], 'exec');
  assert.equal(argv[argv.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(argv.includes('--ignore-user-config') && argv.includes('--ephemeral'));
  assert.match(argv.at(-1)!, /^harness system\n\nthe compiled context$/);
});

test('a failing codex run is no result, with the exit code in the trace', async () => {
  const fake = await fakeCodex({ outcome: 'done' }, [], 2);
  const run = await runCodexExecutor({ executionPath: os.tmpdir(), system: '', prompt: '', config: { ...codexDefaults, command: fake.command }, signal: new AbortController().signal });
  assert.equal(run.result, null);
  assert.match(run.trace.text, /codex exited 2/);
  assert.deepEqual(parseCodexUsage('not json\n{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1}}'), { inputTokens: 5, outputTokens: 1 });
});
