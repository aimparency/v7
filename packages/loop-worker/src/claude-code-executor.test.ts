import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { harnessConfigSchema } from 'shared/harness-config';
import { runClaudeCodeExecutor } from './claude-code-executor.js';
import { fakeClaude } from './fake-claude.js';

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
