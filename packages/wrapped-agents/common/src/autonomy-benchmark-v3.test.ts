import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import type { BenchmarkCondition, BenchmarkRun } from './autonomy-benchmark'
import { FROZEN_AUTONOMY_V2_TASKS } from './autonomy-benchmark-v2'
import { analyzeAutonomyBenchmarkV3, AUTONOMY_BENCHMARK_V3_PROTOCOL } from './autonomy-benchmark-v3'

function run(taskId: string, condition: BenchmarkCondition): BenchmarkRun {
  return {
    taskId, condition, model: AUTONOMY_BENCHMARK_V3_PROTOCOL.model,
    toolProfile: AUTONOMY_BENCHMARK_V3_PROTOCOL.toolProfile,
    tokenBudget: AUTONOMY_BENCHMARK_V3_PROTOCOL.tokenBudget,
    timeBudgetMs: AUTONOMY_BENCHMARK_V3_PROTOCOL.timeBudgetMs,
    verifiedComplete: true, humanInterventions: 0,
    wallTimeMs: condition === 'graph_grounded' ? 80 : 100,
    tokensUsed: condition === 'graph_grounded' ? 800 : 1000,
    toolCalls: condition === 'graph_grounded' ? 8 : 10,
    recoveredFromFailure: true, policyViolations: 0,
    evidenceRefs: [`fixture-v3:${taskId}:${condition}`],
  }
}

const pairs = () => FROZEN_AUTONOMY_V2_TASKS.flatMap(task => [
  run(task.id, 'graph_grounded'), run(task.id, 'stateless'),
])

describe('autonomy benchmark v3 protocol', () => {
  test('freezes the pilot-derived execution manifest before live evidence', () => {
    assert.deepEqual(AUTONOMY_BENCHMARK_V3_PROTOCOL, {
      version: '2026-08-01.v3', model: 'gpt-5.6-sol',
      toolProfile: 'workspace-write-no-network', tokenBudget: 170_000,
      timeBudgetMs: 90_000, requiredRuns: 8,
      order: 'alternating-graph-first-even', retries: 0,
      fixtureVersion: '2026-08-01.v2', scoringVersion: '2026-08-01.v2',
    })
    assert.equal(Object.isFrozen(AUTONOMY_BENCHMARK_V3_PROTOCOL), true)
  })

  test('reports v3 while preserving the preregistered v2 decision rule', () => {
    const report = analyzeAutonomyBenchmarkV3(pairs())
    assert.equal(report.version, '2026-08-01.v3')
    assert.equal(report.result, 'efficiency_positive')
  })

  test('reports incomplete v3 evidence as invalid', () => {
    const report = analyzeAutonomyBenchmarkV3(pairs().slice(1))
    assert.equal(report.version, '2026-08-01.v3')
    assert.equal(report.result, 'invalid')
  })
})
