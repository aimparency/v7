import { spawn } from 'child_process';
import { zodSchema } from 'ai';
import type { HarnessConfig } from 'shared/harness-config';
import type { StageRun } from './stage-runner.js';
import { executionSchema, type Execution } from './stages.js';

// Execute-stage backend that delegates the work to a headless Claude Code
// (`claude -p`) in the loop's execution path. The harness keeps everything
// else: it compiled the prompt, it verifies the result with its own verifier,
// and it alone writes the graph — Claude Code gets no MCP servers.

type ClaudeCodeConfig = HarnessConfig['executor']['claudeCode'];

export function claudeCodeArgs(system: string, prompt: string, config: ClaudeCodeConfig): string[] {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(zodSchema(executionSchema).jsonSchema),
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

export async function runClaudeCodeExecutor(spec: {
  executionPath: string;
  system: string;
  prompt: string;
  config: ClaudeCodeConfig;
  signal: AbortSignal;
}): Promise<StageRun<Execution> & { costUsd: number | null }> {
  const startedAt = Date.now();
  const { stdout, stderr, exitCode } = await run(spec.config.command, claudeCodeArgs(spec.system, spec.prompt, spec.config), spec.executionPath, spec.config.timeoutMs, spec.signal);
  let output: ClaudeCodeOutput | null = null;
  try {
    output = JSON.parse(stdout) as ClaudeCodeOutput;
  } catch {
    output = null;
  }
  const parsed = executionSchema.safeParse(output?.structured_output);
  const result = parsed.success ? parsed.data : null;
  const usage = {
    inputTokens: (output?.usage?.input_tokens ?? 0) + (output?.usage?.cache_creation_input_tokens ?? 0) + (output?.usage?.cache_read_input_tokens ?? 0),
    outputTokens: output?.usage?.output_tokens ?? 0
  };
  const text = output?.result ?? (stdout || stderr).slice(-4000);
  const failure = !output
    ? `claude exited ${exitCode} without JSON output: ${stderr.slice(-1000)}`
    : output.is_error ? `claude reported an error (${output.subtype ?? 'unknown'}): ${output.result ?? ''}` : !result ? 'claude returned no valid structured result' : undefined;
  const costUsd = typeof output?.total_cost_usd === 'number' ? output.total_cost_usd : null;
  return {
    result,
    text,
    usage,
    costUsd,
    trace: {
      stage: 'execute (claude-code)',
      model: { provider: 'anthropic', model: spec.config.model ?? 'claude-code-default', baseUrl: 'claude-code' },
      system: spec.system,
      prompt: spec.prompt,
      toolCalls: [],
      text: failure ? `${failure}\n\n${text}` : text,
      result,
      usage,
      costUsd,
      durationMs: Date.now() - startedAt
    }
  };
}

function run(command: string, args: string[], cwd: string, timeoutMs: number, signal: AbortSignal) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, AIMPARENCY_ALLOW_STOP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Own timer rather than spawn's timeout option, which stays armed when the spawn fails.
    const timer = setTimeout(() => {
      stderr += `\nclaude timed out after ${timeoutMs} ms`;
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
    // A spawn failure (e.g. claude not installed) emits error and never close.
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}
