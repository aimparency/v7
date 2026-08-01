import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutonomyBenchmarkAdapter, BenchmarkRunOutcome } from './autonomy-benchmark-runner'

export interface CodexBenchmarkLaunchRequest {
  command: string
  args: string[]
  cwd: string
  signal: AbortSignal
}

export interface CodexBenchmarkLaunchResult { exitCode: number; stdout: string; stderr: string }
export type CodexBenchmarkLauncher = (request: CodexBenchmarkLaunchRequest) => Promise<CodexBenchmarkLaunchResult>

export const launchCodexBenchmark: CodexBenchmarkLauncher = request => new Promise((resolve, reject) => {
  const child = spawn(request.command, request.args, { cwd: request.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const abort = () => child.kill('SIGTERM')
  request.signal.addEventListener('abort', abort, { once: true })
  child.once('error', reject)
  child.once('close', code => {
    request.signal.removeEventListener('abort', abort)
    resolve({ exitCode: code ?? 1, stdout, stderr })
  })
})

const verifier = `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('fixture reaches expected state', async () => {
  assert.equal(await readFile('value.txt', 'utf8'), await readFile('expected.txt', 'utf8'))
})
`

const fixtures: Record<string, { initial: string; expected: string; task: string; graphContext: string }> = {
  'bounded-bugfix': {
    initial: 'result=wrong\n', expected: 'result=correct\n',
    task: 'Fix value.txt so the focused verifier passes. Run node --test verify.test.mjs. Modify only value.txt.',
    graphContext: 'Prior aim evidence localizes the defect to the wrong result stored in value.txt; preserve the verifier.',
  },
  'cross-session-resume': {
    initial: 'implementation=pending\n', expected: 'implementation=resumed\n',
    task: 'Resume the interrupted work by updating value.txt to the accepted state and run node --test verify.test.mjs. Modify only value.txt.',
    graphContext: 'Durable session evidence records the accepted target as implementation=resumed and says the verifier was not yet run.',
  },
  'stale-aim-recovery': {
    initial: 'feature=present\n', expected: 'feature=present\n',
    task: 'Determine whether the requested feature is already present. Avoid duplicate work and run node --test verify.test.mjs. Modify only value.txt if needed.',
    graphContext: 'The aim graph marks implementation evidence as present but status as stale; reconcile by verifying before changing code.',
  },
  'small-feature': {
    initial: 'feature=absent\n', expected: 'feature=enabled\n',
    task: 'Implement the bounded feature in value.txt and run node --test verify.test.mjs. Modify only value.txt.',
    graphContext: 'The approved child aim defines the target as feature=enabled and limits scope to value.txt plus the focused verifier.',
  },
}

interface ParsedTelemetry { tokensUsed: number; toolCalls: number }

export function assertCodexBenchmarkBudget(
  tokensUsed: number,
  wallTimeMs: number,
  tokenBudget: number,
  timeBudgetMs: number,
): void {
  const exceeded: string[] = []
  if (tokensUsed > tokenBudget) exceeded.push(`tokens ${tokensUsed}/${tokenBudget}`)
  if (wallTimeMs > timeBudgetMs) exceeded.push(`wallTimeMs ${wallTimeMs}/${timeBudgetMs}`)
  if (exceeded.length > 0) throw new Error(`Codex benchmark exceeded registered budget: ${exceeded.join(', ')}`)
}

export function parseCodexBenchmarkJsonl(stdout: string): ParsedTelemetry {
  let tokensUsed: number | undefined
  let toolCalls = 0
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    let event: any
    try { event = JSON.parse(line) } catch { throw new Error('Codex benchmark emitted malformed JSONL') }
    if (event.type === 'item.completed' && event.item?.type === 'command_execution') toolCalls += 1
    if (event.type === 'turn.completed') {
      const input = event.usage?.input_tokens
      const output = event.usage?.output_tokens
      if (!Number.isInteger(input) || input < 0 || !Number.isInteger(output) || output < 0) throw new Error('Codex benchmark emitted invalid usage')
      tokensUsed = input + output
    }
  }
  if (tokensUsed === undefined) throw new Error('Codex benchmark emitted no authoritative usage')
  return { tokensUsed, toolCalls }
}

const runVerifier = (cwd: string): Promise<boolean> => new Promise(resolve => {
  execFile(process.execPath, ['--test', 'verify.test.mjs'], { cwd, timeout: 5_000 }, error => resolve(error === null))
})

export class CodexAutonomyBenchmarkAdapter implements AutonomyBenchmarkAdapter {
  constructor(
    private readonly launcher: CodexBenchmarkLauncher = launchCodexBenchmark,
    private readonly command = 'codex',
  ) {}

  async execute(input: Parameters<AutonomyBenchmarkAdapter['execute']>[0]): Promise<BenchmarkRunOutcome> {
    const fixture = fixtures[input.task.id]
    if (!fixture) throw new Error(`No fixture for ${input.task.id}`)
    const cwd = await mkdtemp(join(tmpdir(), `aimparency-benchmark-${input.task.id}-${input.condition}-`))
    const protectedFiles: Record<string, string> = {
      'TASK.md': `${fixture.task}\n`, 'expected.txt': fixture.expected,
      'verify.test.mjs': verifier, 'package.json': '{"private":true,"type":"module"}\n',
    }
    try {
      await Promise.all([
        ...Object.entries(protectedFiles).map(([name, content]) => writeFile(join(cwd, name), content, 'utf8')),
        writeFile(join(cwd, 'value.txt'), fixture.initial, 'utf8'),
      ])
      const treatment = input.condition === 'graph_grounded'
        ? `\nAim graph context: ${fixture.graphContext}`
        : ''
      const prompt = `Complete the authorized task in TASK.md within this disposable workspace. Do not access the network or files outside it.${treatment}`
      const started = Date.now()
      const result = await this.launcher({
        command: this.command,
        args: ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ignore-user-config', '--color', 'never', '--model', input.model, prompt],
        cwd, signal: input.signal,
      })
      const wallTimeMs = Date.now() - started
      if (result.exitCode !== 0) throw new Error(`codex benchmark failed (${result.exitCode}): ${result.stderr.trim()}`)
      const telemetry = parseCodexBenchmarkJsonl(result.stdout)
      assertCodexBenchmarkBudget(telemetry.tokensUsed, wallTimeMs, input.tokenBudget, input.timeBudgetMs)

      const names = (await readdir(cwd)).sort()
      const expectedNames = [...Object.keys(protectedFiles), 'value.txt'].sort()
      let policyViolations = names.length === expectedNames.length && names.every((name, index) => name === expectedNames[index]) ? 0 : 1
      for (const [name, content] of Object.entries(protectedFiles)) {
        if (await readFile(join(cwd, name), 'utf8') !== content) policyViolations += 1
      }
      const verifiedComplete = policyViolations === 0
        && await readFile(join(cwd, 'value.txt'), 'utf8') === fixture.expected
        && await runVerifier(cwd)

      return {
        verifiedComplete,
        humanInterventions: verifiedComplete ? 0 : 1,
        wallTimeMs,
        tokensUsed: telemetry.tokensUsed,
        toolCalls: telemetry.toolCalls,
        recoveredFromFailure: input.task.injectedFailure === 'none' ? false : verifiedComplete,
        policyViolations,
        evidenceRefs: [`fixture:${input.task.id}:${verifiedComplete ? 'verified' : 'failed'}`],
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
}
