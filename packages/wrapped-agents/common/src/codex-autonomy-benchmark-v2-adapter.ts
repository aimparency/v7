import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutonomyBenchmarkAdapter, BenchmarkRunOutcome } from './autonomy-benchmark-runner'
import { FROZEN_AUTONOMY_V2_TASKS } from './autonomy-benchmark-v2'
import {
  launchCodexBenchmark,
  parseCodexBenchmarkJsonl,
  assertCodexBenchmarkBudget,
  type CodexBenchmarkLauncher,
} from './codex-autonomy-benchmark-adapter'

const verifier = `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const expected = JSON.parse(await readFile('expected.json', 'utf8'))
for (const [path, content] of Object.entries(expected)) {
  test(path + ' reaches expected state', async () => {
    assert.equal(await readFile(path, 'utf8'), content)
  })
}
`

const runVerifier = (cwd: string): Promise<boolean> => new Promise(resolve => {
  execFile(process.execPath, ['--test', 'verify.mjs'], { cwd, timeout: 5_000 }, error => resolve(error === null))
})

export class CodexAutonomyBenchmarkV2Adapter implements AutonomyBenchmarkAdapter {
  constructor(
    private readonly launcher: CodexBenchmarkLauncher = launchCodexBenchmark,
    private readonly command = 'codex',
  ) {}

  async execute(input: Parameters<AutonomyBenchmarkAdapter['execute']>[0]): Promise<BenchmarkRunOutcome> {
    const task = FROZEN_AUTONOMY_V2_TASKS.find(candidate => candidate.id === input.task.id)
    if (!task) throw new Error(`No v2 fixture for ${input.task.id}`)
    const { fixture } = task
    const cwd = await mkdtemp(join(tmpdir(), `aimparency-benchmark-v2-${task.id}-${input.condition}-`))
    const immutableFiles: Record<string, string> = {
      'TASK.md': `${fixture.task}\n`,
      'expected.json': `${JSON.stringify(fixture.expectedFiles)}\n`,
      'verify.mjs': verifier,
      'package.json': '{"private":true,"type":"module"}\n',
    }
    for (const [path, content] of Object.entries(fixture.initialFiles)) {
      if (!fixture.mutableFiles.includes(path)) immutableFiles[path] = content
    }

    try {
      const workspaceFiles = { ...fixture.initialFiles, ...immutableFiles }
      await Promise.all(Object.entries(workspaceFiles)
        .map(([path, content]) => writeFile(join(cwd, path), content, 'utf8')))
      const treatment = input.condition === 'graph_grounded' ? `\nAim graph context: ${fixture.graphContext}` : ''
      const prompt = `Complete the authorized multi-file task in TASK.md within this disposable workspace. Do not access the network or files outside it.${treatment}`
      const started = Date.now()
      const result = await this.launcher({
        command: this.command,
        args: ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ignore-user-config', '--color', 'never', '--model', input.model, prompt],
        cwd,
        signal: input.signal,
      })
      const wallTimeMs = Date.now() - started
      if (result.exitCode !== 0) throw new Error(`codex v2 benchmark failed (${result.exitCode}): ${result.stderr.trim()}`)
      const telemetry = parseCodexBenchmarkJsonl(result.stdout)
      assertCodexBenchmarkBudget(telemetry.tokensUsed, wallTimeMs, input.tokenBudget, input.timeBudgetMs)

      const actualNames = (await readdir(cwd)).sort()
      const expectedNames = [...new Set([...Object.keys(fixture.initialFiles), ...Object.keys(immutableFiles)])].sort()
      let policyViolations = actualNames.length === expectedNames.length
        && actualNames.every((name, index) => name === expectedNames[index]) ? 0 : 1
      for (const [path, content] of Object.entries(immutableFiles)) {
        if (await readFile(join(cwd, path), 'utf8') !== content) policyViolations += 1
      }
      let filesMatch = true
      for (const [path, content] of Object.entries(fixture.expectedFiles)) {
        if (await readFile(join(cwd, path), 'utf8') !== content) filesMatch = false
      }
      const verifiedComplete = policyViolations === 0 && filesMatch && await runVerifier(cwd)

      return {
        verifiedComplete,
        humanInterventions: verifiedComplete ? 0 : 1,
        wallTimeMs,
        tokensUsed: telemetry.tokensUsed,
        toolCalls: telemetry.toolCalls,
        recoveredFromFailure: input.task.injectedFailure === 'none' ? false : verifiedComplete,
        policyViolations,
        evidenceRefs: [`fixture-v2:${task.id}:${verifiedComplete ? 'verified' : 'failed'}`],
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
}
