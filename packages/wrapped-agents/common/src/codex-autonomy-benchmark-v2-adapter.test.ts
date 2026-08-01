import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { FROZEN_AUTONOMY_V2_TASKS } from './autonomy-benchmark-v2'
import { CodexAutonomyBenchmarkV2Adapter } from './codex-autonomy-benchmark-v2-adapter'
import type { CodexBenchmarkLaunchRequest, CodexBenchmarkLauncher } from './codex-autonomy-benchmark-adapter'

const jsonl = (tokens = 200) => [
  JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: tokens - 20, output_tokens: 20 } }),
].join('\n')

const input = (taskIndex = 0, condition: 'graph_grounded' | 'stateless' = 'stateless') => ({
  task: FROZEN_AUTONOMY_V2_TASKS[taskIndex], condition, model: 'test-model',
  toolProfile: 'workspace-write-no-network', tokenBudget: 1_000, timeBudgetMs: 10_000,
  signal: new AbortController().signal,
})

function fixtureFor(request: CodexBenchmarkLaunchRequest) {
  return FROZEN_AUTONOMY_V2_TASKS.find(task => request.cwd.includes(task.id))!.fixture
}

const completingLauncher: CodexBenchmarkLauncher = async request => {
  for (const [path, content] of Object.entries(fixtureFor(request).expectedFiles)) {
    await writeFile(`${request.cwd}/${path}`, content, 'utf8')
  }
  return { exitCode: 0, stdout: jsonl(), stderr: '' }
}

describe('Codex autonomy benchmark v2 adapter', () => {
  test('independently verifies every frozen multi-file fixture', async () => {
    const adapter = new CodexAutonomyBenchmarkV2Adapter(completingLauncher)
    for (const [index, task] of FROZEN_AUTONOMY_V2_TASKS.entries()) {
      const result = await adapter.execute(input(index))
      assert.equal(result.verifiedComplete, true, task.id)
      assert.equal(result.policyViolations, 0)
      assert.equal(result.tokensUsed, 200)
    }
  })

  test('injects graph context only into treatment prompts', async () => {
    const prompts: string[] = []
    const launcher: CodexBenchmarkLauncher = async request => {
      prompts.push(request.args[request.args.length - 1])
      return completingLauncher(request)
    }
    const adapter = new CodexAutonomyBenchmarkV2Adapter(launcher)
    await adapter.execute(input(0, 'stateless'))
    await adapter.execute(input(0, 'graph_grounded'))
    assert.doesNotMatch(prompts[0], /Aim graph context:/)
    assert.match(prompts[1], /Aim graph context:/)
  })

  test('fails closed on protected evidence tampering and unexpected files', async () => {
    const result = await new CodexAutonomyBenchmarkV2Adapter(async request => {
      await completingLauncher(request)
      await writeFile(`${request.cwd}/TASK.md`, 'changed\n', 'utf8')
      await writeFile(`${request.cwd}/extra.txt`, 'unexpected\n', 'utf8')
      return { exitCode: 0, stdout: jsonl(), stderr: '' }
    }).execute(input())
    assert.equal(result.verifiedComplete, false)
    assert.ok(result.policyViolations >= 2)
  })

  test('rejects malformed telemetry, nonzero exit, and budget overruns', async () => {
    await assert.rejects(new CodexAutonomyBenchmarkV2Adapter(async () => ({ exitCode: 0, stdout: '{}', stderr: '' })).execute(input()), /usage/)
    await assert.rejects(new CodexAutonomyBenchmarkV2Adapter(async () => ({ exitCode: 2, stdout: '', stderr: 'nope' })).execute(input()), /nope/)
    await assert.rejects(new CodexAutonomyBenchmarkV2Adapter(async () => ({ exitCode: 0, stdout: jsonl(2_000), stderr: '' })).execute(input()), /budget/)
  })

  test('passes the abort signal and uses shell-free least-authority argv', async () => {
    const controller = new AbortController()
    let captured: CodexBenchmarkLaunchRequest | undefined
    const launcher: CodexBenchmarkLauncher = async request => { captured = request; return completingLauncher(request) }
    await new CodexAutonomyBenchmarkV2Adapter(launcher).execute({ ...input(), signal: controller.signal })
    assert.equal(captured?.signal, controller.signal)
    assert.deepEqual(captured?.args.slice(0, 7), ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ignore-user-config'])
    assert.ok(!captured?.args.includes('--dangerously-bypass-approvals-and-sandbox'))
  })
})
