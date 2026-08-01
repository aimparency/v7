import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { analyzeAutonomyBenchmark, FROZEN_AUTONOMY_TASKS, type BenchmarkCondition, type BenchmarkRun } from './autonomy-benchmark'

function run(taskId: string, condition: BenchmarkCondition, overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    taskId, condition, model: 'fixed-model', toolProfile: 'local-tools-v1', tokenBudget: 10_000,
    timeBudgetMs: 600_000, verifiedComplete: true, humanInterventions: condition === 'graph_grounded' ? 0 : 1,
    wallTimeMs: 1000, tokensUsed: 1000, toolCalls: 10, recoveredFromFailure: true,
    policyViolations: 0, evidenceRefs: [`trace:${taskId}:${condition}`], ...overrides,
  }
}

function pairedRuns(): BenchmarkRun[] {
  return FROZEN_AUTONOMY_TASKS.flatMap(task => [run(task.id, 'graph_grounded'), run(task.id, 'stateless')])
}

describe('autonomy benchmark analyzer', () => {
  test('reports a positive matched comparison', () => {
    const report = analyzeAutonomyBenchmark(pairedRuns())
    assert.equal(report.valid, true)
    assert.equal(report.result, 'positive')
    assert.equal(report.graphGrounded?.completionRate, 1)
  })

  test('reports null when conditions perform equally', () => {
    const runs = pairedRuns().map(item => ({ ...item, humanInterventions: 1 }))
    assert.equal(analyzeAutonomyBenchmark(runs).result, 'null')

    const zeroBaseline = pairedRuns().map(item => ({ ...item, humanInterventions: 0 }))
    assert.equal(analyzeAutonomyBenchmark(zeroBaseline).result, 'null')
  })

  test('reports negative for worse completion or safety', () => {
    const runs = pairedRuns()
    runs[0] = { ...runs[0], verifiedComplete: false }
    assert.equal(analyzeAutonomyBenchmark(runs).result, 'negative')
    const unsafe = pairedRuns()
    unsafe[0] = { ...unsafe[0], policyViolations: 1 }
    assert.equal(analyzeAutonomyBenchmark(unsafe).result, 'negative')
  })

  test('rejects incomplete, duplicate, unmatched-budget, and evidence-free pairs', () => {
    assert.equal(analyzeAutonomyBenchmark(pairedRuns().slice(1)).result, 'invalid')
    assert.equal(analyzeAutonomyBenchmark([...pairedRuns(), pairedRuns()[0]]).result, 'invalid')
    const mismatched = pairedRuns()
    mismatched[0] = { ...mismatched[0], tokenBudget: 99 }
    assert.equal(analyzeAutonomyBenchmark(mismatched).result, 'invalid')
    const evidenceFree = pairedRuns()
    evidenceFree[0] = { ...evidenceFree[0], evidenceRefs: [] }
    assert.equal(analyzeAutonomyBenchmark(evidenceFree).result, 'invalid')
  })

  test('rejects invalid or budget-exceeding telemetry', () => {
    const negative = pairedRuns()
    negative[0] = { ...negative[0], humanInterventions: -1 }
    assert.equal(analyzeAutonomyBenchmark(negative).result, 'invalid')

    const nonFinite = pairedRuns()
    nonFinite[0] = { ...nonFinite[0], tokensUsed: Number.NaN }
    assert.equal(analyzeAutonomyBenchmark(nonFinite).result, 'invalid')

    const exceeded = pairedRuns()
    exceeded[0] = { ...exceeded[0], tokensUsed: exceeded[0].tokenBudget + 1 }
    assert.equal(analyzeAutonomyBenchmark(exceeded).result, 'invalid')
  })
})
