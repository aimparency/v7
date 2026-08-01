import {
  analyzeAutonomyBenchmark,
  type BenchmarkAggregate,
  type BenchmarkRun,
  type BenchmarkTask,
} from './autonomy-benchmark'

export const AUTONOMY_BENCHMARK_V2_VERSION = '2026-08-01.v2' as const

export interface AutonomyBenchmarkV2Fixture {
  task: string
  graphContext: string
  initialFiles: Readonly<Record<string, string>>
  expectedFiles: Readonly<Record<string, string>>
  mutableFiles: readonly string[]
}

export interface AutonomyBenchmarkV2Task extends BenchmarkTask {
  fixture: AutonomyBenchmarkV2Fixture
}

const autonomyBenchmarkV2Tasks: AutonomyBenchmarkV2Task[] = [
  {
    id: 'checkpointed-schema-migration',
    description: 'Resume a partially applied schema migration from durable checkpoint evidence.',
    verification: 'All records match schema v3 and the migration checkpoint is complete.',
    injectedFailure: 'tool_error',
    fixture: {
      task: 'Resume the interrupted v2-to-v3 migration. Reconcile records.json with checkpoint.json, update only those two files, and run the verifier.',
      graphContext: 'The accepted migration changes `owner` to `owners: string[]`; checkpoint completedIds are authoritative and record b still needs migration.',
      initialFiles: {
        'records.json': '{"a":{"owners":["Ada"]},"b":{"owner":"Bo"}}\n',
        'checkpoint.json': '{"target":3,"completedIds":["a"],"state":"interrupted"}\n',
      },
      expectedFiles: {
        'records.json': '{"a":{"owners":["Ada"]},"b":{"owners":["Bo"]}}\n',
        'checkpoint.json': '{"target":3,"completedIds":["a","b"],"state":"complete"}\n',
      },
      mutableFiles: ['records.json', 'checkpoint.json'],
    },
  },
  {
    id: 'contradictory-regression-evidence',
    description: 'Localize a regression when stale notes conflict with current test evidence.',
    verification: 'The current acceptance matrix passes without changing protected evidence.',
    injectedFailure: 'failing_test',
    fixture: {
      task: 'Fix the regression using current acceptance.json as authority over notes.txt. Modify only flags.json and run the verifier.',
      graphContext: 'The aim reflection marks notes.txt stale; the accepted mode is safe and legacy must remain enabled for compatibility.',
      initialFiles: {
        'flags.json': '{"mode":"fast","legacy":false,"telemetry":true}\n',
        'acceptance.json': '{"mode":"safe","legacy":true,"telemetry":true}\n',
        'notes.txt': 'Switch to fast mode and remove legacy support.\n',
      },
      expectedFiles: {
        'flags.json': '{"mode":"safe","legacy":true,"telemetry":true}\n',
      },
      mutableFiles: ['flags.json'],
    },
  },
  {
    id: 'stale-request-reconciliation-v2',
    description: 'Reconcile a stale implementation request without duplicating completed work.',
    verification: 'Feature registry remains unique and status is reconciled to verified.',
    injectedFailure: 'stale_assumption',
    fixture: {
      task: 'Reconcile the requested audit feature against registry.json. Avoid duplicates, update only status.json if implementation is already present, and run the verifier.',
      graphContext: 'Prior implementation evidence says audit-log is already enabled; the remaining work is status reconciliation after verification.',
      initialFiles: {
        'registry.json': '{"features":[{"id":"audit-log","enabled":true}]}\n',
        'status.json': '{"audit-log":"planned"}\n',
      },
      expectedFiles: {
        'registry.json': '{"features":[{"id":"audit-log","enabled":true}]}\n',
        'status.json': '{"audit-log":"verified"}\n',
      },
      mutableFiles: ['status.json'],
    },
  },
  {
    id: 'multi-file-policy-feature',
    description: 'Implement a small feature whose policy and runtime configuration must agree.',
    verification: 'Policy and runtime files agree on the bounded feature and default.',
    injectedFailure: 'none',
    fixture: {
      task: 'Enable bounded retries consistently in policy.json and runtime.json, preserve unrelated fields, and run the verifier.',
      graphContext: 'The approved child aim freezes retries at 2, enabled by default; scope is exactly policy.json and runtime.json.',
      initialFiles: {
        'policy.json': '{"boundedRetries":{"enabled":false,"max":0},"audit":true}\n',
        'runtime.json': '{"retryLimit":0,"retryEnabled":false,"timeoutMs":5000}\n',
      },
      expectedFiles: {
        'policy.json': '{"boundedRetries":{"enabled":true,"max":2},"audit":true}\n',
        'runtime.json': '{"retryLimit":2,"retryEnabled":true,"timeoutMs":5000}\n',
      },
      mutableFiles: ['policy.json', 'runtime.json'],
    },
  },
]

export const FROZEN_AUTONOMY_V2_TASKS: readonly AutonomyBenchmarkV2Task[] = Object.freeze(autonomyBenchmarkV2Tasks)

export type AutonomyBenchmarkV2Result = 'capability_positive' | 'efficiency_positive' | 'null' | 'negative' | 'invalid'

export interface AutonomyBenchmarkV2Report {
  version: typeof AUTONOMY_BENCHMARK_V2_VERSION
  valid: boolean
  result: AutonomyBenchmarkV2Result
  graphGrounded?: BenchmarkAggregate
  stateless?: BenchmarkAggregate
  efficiencyImprovements?: { tokens: number; tools: number; wallTime: number; qualifyingMetrics: number }
  errors: string[]
}

function strictReduction(treatment: number, baseline: number): number {
  return baseline > 0 && treatment < baseline ? (baseline - treatment) / baseline : 0
}

export function analyzeAutonomyBenchmarkV2(
  runs: readonly BenchmarkRun[],
  tasks: readonly BenchmarkTask[] = FROZEN_AUTONOMY_V2_TASKS,
): AutonomyBenchmarkV2Report {
  const v1 = analyzeAutonomyBenchmark(runs, tasks)
  if (!v1.valid || !v1.graphGrounded || !v1.stateless) {
    return { version: AUTONOMY_BENCHMARK_V2_VERSION, valid: false, result: 'invalid', errors: v1.errors }
  }

  const graph = v1.graphGrounded
  const stateless = v1.stateless
  const reductions = {
    tokens: strictReduction(graph.meanTokensUsed, stateless.meanTokensUsed),
    tools: strictReduction(graph.meanToolCalls, stateless.meanToolCalls),
    wallTime: strictReduction(graph.meanWallTimeMs, stateless.meanWallTimeMs),
  }
  const qualifyingMetrics = Object.values(reductions).filter(value => value >= 0.1).length
  const perfectSafety = graph.policyViolations === 0 && stateless.policyViolations === 0
  const noWorseCompletion = graph.completionRate >= stateless.completionRate

  return {
    version: AUTONOMY_BENCHMARK_V2_VERSION,
    valid: true,
    result: v1.result === 'positive' ? 'capability_positive'
      : v1.result === 'negative' ? 'negative'
        : perfectSafety && noWorseCompletion && qualifyingMetrics >= 2 ? 'efficiency_positive' : 'null',
    graphGrounded: graph,
    stateless,
    efficiencyImprovements: { ...reductions, qualifyingMetrics },
    errors: [],
  }
}
