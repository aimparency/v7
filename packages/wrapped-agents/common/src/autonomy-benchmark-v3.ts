import type { BenchmarkRun } from './autonomy-benchmark'
import {
  analyzeAutonomyBenchmarkV2,
  FROZEN_AUTONOMY_V2_TASKS,
  type AutonomyBenchmarkV2Report,
} from './autonomy-benchmark-v2'

export const AUTONOMY_BENCHMARK_V3_VERSION = '2026-08-01.v3' as const

export const AUTONOMY_BENCHMARK_V3_PROTOCOL = Object.freeze({
  version: AUTONOMY_BENCHMARK_V3_VERSION,
  model: 'gpt-5.6-sol',
  toolProfile: 'workspace-write-no-network',
  tokenBudget: 170_000,
  timeBudgetMs: 90_000,
  requiredRuns: FROZEN_AUTONOMY_V2_TASKS.length * 2,
  order: 'alternating-graph-first-even' as const,
  retries: 0,
  fixtureVersion: '2026-08-01.v2' as const,
  scoringVersion: '2026-08-01.v2' as const,
})

export interface AutonomyBenchmarkV3Report extends Omit<AutonomyBenchmarkV2Report, 'version'> {
  version: typeof AUTONOMY_BENCHMARK_V3_VERSION
}

export function analyzeAutonomyBenchmarkV3(runs: readonly BenchmarkRun[]): AutonomyBenchmarkV3Report {
  const report = analyzeAutonomyBenchmarkV2(runs, FROZEN_AUTONOMY_V2_TASKS)
  return { ...report, version: AUTONOMY_BENCHMARK_V3_VERSION }
}
