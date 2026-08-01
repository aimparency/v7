import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import type { BenchmarkCondition, BenchmarkRun } from './autonomy-benchmark'
import { analyzeAutonomyBenchmarkV2, FROZEN_AUTONOMY_V2_TASKS } from './autonomy-benchmark-v2'

function run(taskId: string, condition: BenchmarkCondition, overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    taskId, condition, model: 'gpt-5.6-sol', toolProfile: 'workspace-write-no-network',
    tokenBudget: 100_000, timeBudgetMs: 120_000, verifiedComplete: true, humanInterventions: 0,
    wallTimeMs: condition === 'graph_grounded' ? 80 : 100,
    tokensUsed: condition === 'graph_grounded' ? 800 : 1000,
    toolCalls: condition === 'graph_grounded' ? 9 : 10,
    recoveredFromFailure: true, policyViolations: 0,
    evidenceRefs: [`fixture-v2:${taskId}:${condition}`], ...overrides,
  }
}

function pairs(overrides: (condition: BenchmarkCondition) => Partial<BenchmarkRun> = () => ({})): BenchmarkRun[] {
  return FROZEN_AUTONOMY_V2_TASKS.flatMap(task => [
    run(task.id, 'graph_grounded', overrides('graph_grounded')),
    run(task.id, 'stateless', overrides('stateless')),
  ])
}

describe('autonomy benchmark v2', () => {
  test('freezes four multi-file, bounded, independently checkable fixtures', () => {
    assert.equal(FROZEN_AUTONOMY_V2_TASKS.length, 4)
    assert.equal(new Set(FROZEN_AUTONOMY_V2_TASKS.map(task => task.id)).size, 4)
    for (const { fixture } of FROZEN_AUTONOMY_V2_TASKS) {
      assert.ok(Object.keys(fixture.initialFiles).length >= 2)
      assert.ok(fixture.mutableFiles.length > 0)
      assert.ok(fixture.graphContext.length > 20)
      for (const path of fixture.mutableFiles) assert.ok(path in fixture.expectedFiles)
    }
  })

  test('reports a preregistered efficiency positive only when two metrics improve by ten percent', () => {
    const report = analyzeAutonomyBenchmarkV2(pairs())
    assert.equal(report.result, 'efficiency_positive')
    assert.equal(report.efficiencyImprovements?.qualifyingMetrics, 3)
  })

  test('keeps one qualifying efficiency metric null', () => {
    const runs = pairs(condition => condition === 'graph_grounded'
      ? { wallTimeMs: 95, tokensUsed: 800, toolCalls: 10 }
      : { wallTimeMs: 100, tokensUsed: 1000, toolCalls: 10 })
    assert.equal(analyzeAutonomyBenchmarkV2(runs).result, 'null')
  })

  test('guards zero baselines and requires strict absolute improvement', () => {
    const runs = pairs(() => ({ wallTimeMs: 0, tokensUsed: 0, toolCalls: 0 }))
    const report = analyzeAutonomyBenchmarkV2(runs)
    assert.equal(report.result, 'null')
    assert.deepEqual(report.efficiencyImprovements, { tokens: 0, tools: 0, wallTime: 0, qualifyingMetrics: 0 })
  })

  test('prioritizes capability gains and rejects worse completion or safety', () => {
    const capability = pairs(condition => condition === 'stateless' ? { verifiedComplete: false, humanInterventions: 1 } : {})
    assert.equal(analyzeAutonomyBenchmarkV2(capability).result, 'capability_positive')

    const worse = pairs()
    worse[0] = { ...worse[0], policyViolations: 1 }
    assert.equal(analyzeAutonomyBenchmarkV2(worse).result, 'negative')
  })

  test('fails closed on incomplete matched evidence', () => {
    assert.equal(analyzeAutonomyBenchmarkV2(pairs().slice(1)).result, 'invalid')
  })
})
