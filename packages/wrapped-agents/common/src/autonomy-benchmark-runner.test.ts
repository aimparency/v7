import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { runAutonomyBenchmark, type AutonomyBenchmarkAdapter } from './autonomy-benchmark-runner'
import { FROZEN_AUTONOMY_TASKS, type BenchmarkCondition } from './autonomy-benchmark'

const options = { model: 'fixed-model', toolProfile: 'local-v1', tokenBudget: 1000, timeBudgetMs: 100 }
const outcome = () => ({ verifiedComplete: true, humanInterventions: 0, wallTimeMs: 10, tokensUsed: 50, toolCalls: 2, recoveredFromFailure: true, policyViolations: 0, evidenceRefs: ['trace'] })

describe('autonomy benchmark runner', () => {
  test('executes complete matched pairs and stamps protected fields', async () => {
    const seen: Array<[string, BenchmarkCondition]> = []
    const result = await runAutonomyBenchmark({ async execute(input) { seen.push([input.task.id, input.condition]); return outcome() } }, options)
    assert.equal(result.errors.length, 0)
    assert.equal(result.report.valid, true)
    assert.equal(result.runs.length, FROZEN_AUTONOMY_TASKS.length * 2)
    assert.ok(result.runs.every(run => run.model === options.model && run.tokenBudget === options.tokenBudget))
    assert.equal(seen.length, result.runs.length)
  })

  test('accepts deterministic counterbalancing while retaining matched pairs', async () => {
    const order: BenchmarkCondition[] = []
    const result = await runAutonomyBenchmark({ async execute(input) { order.push(input.condition); return outcome() } }, {
      ...options,
      orderPair: (_task, index) => index % 2 === 0 ? ['stateless', 'graph_grounded'] : ['graph_grounded', 'stateless'],
    })
    assert.deepEqual(order.slice(0, 4), ['stateless', 'graph_grounded', 'graph_grounded', 'stateless'])
    assert.equal(result.report.valid, true)
  })

  test('records adapter errors and returns an invalid incomplete report', async () => {
    const adapter: AutonomyBenchmarkAdapter = { async execute(input) { if (input.condition === 'stateless') throw new Error('sandbox failed'); return outcome() } }
    const result = await runAutonomyBenchmark(adapter, { ...options, tasks: [FROZEN_AUTONOMY_TASKS[0]] })
    assert.equal(result.errors[0].type, 'adapter_error')
    assert.equal(result.report.result, 'invalid')
  })

  test('aborts and records timed-out runs', async () => {
    let aborted = false
    const result = await runAutonomyBenchmark({ execute(input) { input.signal.addEventListener('abort', () => { aborted = true }); return new Promise(() => {}) } }, {
      ...options, timeBudgetMs: 5, tasks: [FROZEN_AUTONOMY_TASKS[0]],
    })
    assert.equal(result.errors.length, 2)
    assert.ok(result.errors.every(error => error.type === 'timeout'))
    assert.equal(aborted, true)
    assert.equal(result.report.result, 'invalid')
  })

  test('rejects invalid pair ordering before execution', async () => {
    await assert.rejects(
      runAutonomyBenchmark({ async execute() { return outcome() } }, { ...options, tasks: [FROZEN_AUTONOMY_TASKS[0]], orderPair: () => ['stateless', 'stateless'] }),
      /exactly once/,
    )
  })
})
