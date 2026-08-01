import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertCodexBenchmarkBudget, CodexAutonomyBenchmarkAdapter, parseCodexBenchmarkJsonl, type CodexBenchmarkLaunchRequest, type CodexBenchmarkLauncher } from './codex-autonomy-benchmark-adapter'
import { FROZEN_AUTONOMY_TASKS } from './autonomy-benchmark'

const jsonl = (tokens = 120) => [
  JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: tokens - 20, output_tokens: 20 } }),
].join('\n')

const input = (condition: 'graph_grounded' | 'stateless' = 'stateless') => ({
  task: FROZEN_AUTONOMY_TASKS[0], condition, model: 'test-model', toolProfile: 'workspace-write-no-network',
  tokenBudget: 1_000, timeBudgetMs: 10_000, signal: new AbortController().signal,
})

describe('Codex autonomy benchmark adapter', () => {
  test('parses authoritative token and tool telemetry and rejects malformed traces', () => {
    assert.deepEqual(parseCodexBenchmarkJsonl(jsonl()), { tokensUsed: 120, toolCalls: 1 })
    assert.throws(() => parseCodexBenchmarkJsonl('{}'), /no authoritative usage/)
    assert.throws(() => parseCodexBenchmarkJsonl('nope'), /malformed JSONL/)
  })

  test('reports every exceeded budget dimension with actual and limit values', () => {
    assert.doesNotThrow(() => assertCodexBenchmarkBudget(100, 200, 100, 200))
    assert.throws(() => assertCodexBenchmarkBudget(101, 200, 100, 200), /tokens 101\/100/)
    assert.throws(() => assertCodexBenchmarkBudget(100, 201, 100, 200), /wallTimeMs 201\/200/)
    assert.throws(
      () => assertCodexBenchmarkBudget(101, 201, 100, 200),
      /tokens 101\/100, wallTimeMs 201\/200/,
    )
  })

  test('uses safe argv and independently verifies the disposable fixture', async () => {
    let captured: CodexBenchmarkLaunchRequest | undefined
    const launcher: CodexBenchmarkLauncher = async request => {
      captured = request
      await writeFile(`${request.cwd}/value.txt`, 'result=correct\n', 'utf8')
      return { exitCode: 0, stdout: jsonl(), stderr: '' }
    }
    const result = await new CodexAutonomyBenchmarkAdapter(launcher).execute(input())
    assert.deepEqual(captured?.args.slice(0, 7), ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ignore-user-config'])
    assert.ok(!captured?.args.includes('--dangerously-bypass-approvals-and-sandbox'))
    assert.equal(result.verifiedComplete, true)
    assert.equal(result.tokensUsed, 120)
    assert.equal(result.toolCalls, 1)
  })

  test('injects graph context only in the treatment condition', async () => {
    const prompts: string[] = []
    const launcher: CodexBenchmarkLauncher = async request => {
      prompts.push(request.args[request.args.length - 1])
      return { exitCode: 0, stdout: jsonl(), stderr: '' }
    }
    const adapter = new CodexAutonomyBenchmarkAdapter(launcher)
    await adapter.execute(input('stateless'))
    await adapter.execute(input('graph_grounded'))
    assert.doesNotMatch(prompts[0], /Aim graph context:/)
    assert.match(prompts[1], /Aim graph context:/)
  })

  test('fails verification closed on unchanged value or verifier tampering', async () => {
    const unchanged = await new CodexAutonomyBenchmarkAdapter(async () => ({ exitCode: 0, stdout: jsonl(), stderr: '' })).execute(input())
    assert.equal(unchanged.verifiedComplete, false)
    const tampered = await new CodexAutonomyBenchmarkAdapter(async request => {
      await writeFile(`${request.cwd}/value.txt`, 'result=correct\n', 'utf8')
      await writeFile(`${request.cwd}/verify.test.mjs`, '', 'utf8')
      return { exitCode: 0, stdout: jsonl(), stderr: '' }
    }).execute(input())
    assert.equal(tampered.verifiedComplete, false)
    assert.ok(tampered.policyViolations > 0)
  })

  test('passes abort signal and rejects exit, telemetry, and budget failures', async () => {
    const controller = new AbortController()
    let sameSignal = false
    const adapter = new CodexAutonomyBenchmarkAdapter(async request => { sameSignal = request.signal === controller.signal; return { exitCode: 2, stdout: '', stderr: 'failed' } })
    await assert.rejects(adapter.execute({ ...input(), signal: controller.signal }), /failed/)
    assert.equal(sameSignal, true)
    await assert.rejects(new CodexAutonomyBenchmarkAdapter(async () => ({ exitCode: 0, stdout: '{}', stderr: '' })).execute(input()), /usage/)
    await assert.rejects(new CodexAutonomyBenchmarkAdapter(async () => ({ exitCode: 0, stdout: jsonl(2_000), stderr: '' })).execute(input()), /budget/)
  })
})
