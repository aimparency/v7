import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { zodSchema } from 'ai';
import type { HarnessConfig } from 'shared/harness-config';
import type { RoleModelSpec } from './models.js';
import type { StageRun, StageUsage } from './stage-runner.js';
import { executionSchema, type Execution } from './stages.js';

// Execute-stage backends that delegate the work to a headless coding CLI
// (Claude Code or Codex) in the loop's execution path. The harness keeps
// everything else: it compiled the prompt, verifies the result with its own
// verifier, and alone writes the graph — the CLIs get no MCP servers.

type ExecutorConfig = HarnessConfig['executor'];
type CliSpec = { executionPath: string; system: string; prompt: string; signal: AbortSignal };
export type CliRun = StageRun<Execution> & { costUsd: number | null };

const executionJsonSchema = () => JSON.stringify(zodSchema(executionSchema).jsonSchema);

export function claudeCodeArgs(system: string, prompt: string, config: ExecutorConfig['claudeCode']): string[] {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--json-schema', executionJsonSchema(),
    '--append-system-prompt', system,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...config.allowedTools,
    // No MCP servers (graph writes stay with the harness) and no project
    // settings, whose Stop hook would keep a headless session from ending.
    '--strict-mcp-config',
    '--setting-sources', 'user',
    '--max-budget-usd', String(config.maxBudgetUsd),
    ...(config.model ? ['--model', config.model] : [])
  ];
}

type ClaudeCodeOutput = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
};

export async function runClaudeCodeExecutor(spec: CliSpec & { config: ExecutorConfig['claudeCode'] }): Promise<CliRun> {
  const startedAt = Date.now();
  const { stdout, stderr, exitCode } = await run(spec.config.command, claudeCodeArgs(spec.system, spec.prompt, spec.config), spec.executionPath, spec.config.timeoutMs, spec.signal);
  const output = parseJson<ClaudeCodeOutput>(stdout);
  const usage = {
    inputTokens: (output?.usage?.input_tokens ?? 0) + (output?.usage?.cache_creation_input_tokens ?? 0) + (output?.usage?.cache_read_input_tokens ?? 0),
    outputTokens: output?.usage?.output_tokens ?? 0
  };
  const failure = !output
    ? `claude exited ${exitCode} without JSON output: ${stderr.slice(-1000)}`
    : output.is_error ? `claude reported an error (${output.subtype ?? 'unknown'}): ${output.result ?? ''}` : undefined;
  return cliRun({
    spec,
    startedAt,
    stage: 'execute (claude-code)',
    model: { provider: 'anthropic', model: spec.config.model ?? 'claude-code-default', baseUrl: 'claude-code' },
    structured: output?.structured_output,
    text: output?.result ?? (stdout || stderr).slice(-4000),
    failure,
    usage,
    costUsd: typeof output?.total_cost_usd === 'number' ? output.total_cost_usd : null
  });
}

export function codexArgs(system: string, prompt: string, schemaFile: string, lastMessageFile: string, config: ExecutorConfig['codex']): string[] {
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox', 'workspace-write',
    '--skip-git-repo-check',
    // No user config: its MCP servers would give Codex graph tools.
    '--ignore-user-config',
    '--color', 'never',
    '--output-schema', schemaFile,
    '--output-last-message', lastMessageFile,
    ...(config.model ? ['--model', config.model] : []),
    `${system}\n\n${prompt}`
  ];
}

/** Sums the authoritative usage of every completed turn in codex exec --json output. */
export function parseCodexUsage(jsonl: string): StageUsage {
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (const line of jsonl.split('\n')) {
    const event = parseJson<{ type?: string; usage?: { input_tokens?: number; output_tokens?: number } }>(line);
    if (event?.type !== 'turn.completed') continue;
    usage.inputTokens += event.usage?.input_tokens ?? 0;
    usage.outputTokens += event.usage?.output_tokens ?? 0;
  }
  return usage;
}

/** Codex reports no price; its cost comes from harness.json prices like any other model. */
export async function runCodexExecutor(spec: CliSpec & { config: ExecutorConfig['codex'] }): Promise<CliRun> {
  const startedAt = Date.now();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-codex-'));
  try {
    const schemaFile = path.join(dir, 'execution.schema.json');
    const lastMessageFile = path.join(dir, 'last-message.json');
    await fs.writeFile(schemaFile, executionJsonSchema());
    const { stdout, stderr, exitCode } = await run(spec.config.command, codexArgs(spec.system, spec.prompt, schemaFile, lastMessageFile, spec.config), spec.executionPath, spec.config.timeoutMs, spec.signal);
    const lastMessage = await fs.readFile(lastMessageFile, 'utf8').catch(() => '');
    return cliRun({
      spec,
      startedAt,
      stage: 'execute (codex)',
      model: { provider: 'openai-compatible', model: spec.config.model ?? 'codex-default', baseUrl: 'codex' },
      structured: parseJson(lastMessage),
      text: lastMessage || stderr.slice(-4000),
      failure: exitCode !== 0 ? `codex exited ${exitCode}: ${stderr.slice(-1000)}` : undefined,
      usage: parseCodexUsage(stdout),
      costUsd: undefined
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function cliRun(input: {
  spec: CliSpec;
  startedAt: number;
  stage: string;
  model: RoleModelSpec;
  structured: unknown;
  text: string;
  failure: string | undefined;
  usage: StageUsage;
  /** undefined: price it from harness.json; null: known to be unknown. */
  costUsd: number | null | undefined;
}): CliRun {
  const parsed = executionSchema.safeParse(input.structured);
  const result = parsed.success ? parsed.data : null;
  const failure = input.failure ?? (result ? undefined : 'no valid structured result');
  return {
    result,
    text: input.text,
    usage: input.usage,
    costUsd: input.costUsd ?? null,
    trace: {
      stage: input.stage,
      model: input.model,
      system: input.spec.system,
      prompt: input.spec.prompt,
      toolCalls: [],
      text: failure ? `${failure}\n\n${input.text}` : input.text,
      result,
      usage: input.usage,
      ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
      durationMs: Date.now() - input.startedAt
    }
  };
}

function parseJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function run(command: string, args: string[], cwd: string, timeoutMs: number, signal: AbortSignal) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      // The repo's continuation hook must let a headless session end.
      env: { ...process.env, AIMPARENCY_ALLOW_STOP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Own timer rather than spawn's timeout option, which stays armed when the spawn fails.
    const timer = setTimeout(() => {
      stderr += `\n${command} timed out after ${timeoutMs} ms`;
      child.kill('SIGTERM');
    }, timeoutMs);
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // A spawn failure (e.g. the CLI is not installed) emits error and never close.
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}
