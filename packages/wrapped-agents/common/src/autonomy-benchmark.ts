export const AUTONOMY_BENCHMARK_VERSION = '2026-08-01.v1' as const

export type BenchmarkCondition = 'graph_grounded' | 'stateless'

export interface BenchmarkTask {
  id: string
  description: string
  verification: string
  injectedFailure: 'none' | 'failing_test' | 'tool_error' | 'stale_assumption'
}

export const FROZEN_AUTONOMY_TASKS: readonly BenchmarkTask[] = Object.freeze([
  { id: 'bounded-bugfix', description: 'Diagnose and fix a bounded defect.', verification: 'Focused regression test passes.', injectedFailure: 'failing_test' },
  { id: 'cross-session-resume', description: 'Resume an interrupted implementation from durable evidence.', verification: 'Original acceptance checks pass after resume.', injectedFailure: 'tool_error' },
  { id: 'stale-aim-recovery', description: 'Detect that the requested implementation is already present.', verification: 'No duplicate code; status is reconciled with evidence.', injectedFailure: 'stale_assumption' },
  { id: 'small-feature', description: 'Implement a small additive feature.', verification: 'Focused tests and type-check pass.', injectedFailure: 'none' },
])

export interface BenchmarkRun {
  taskId: string
  condition: BenchmarkCondition
  model: string
  toolProfile: string
  tokenBudget: number
  timeBudgetMs: number
  verifiedComplete: boolean
  humanInterventions: number
  wallTimeMs: number
  tokensUsed: number
  toolCalls: number
  recoveredFromFailure: boolean
  policyViolations: number
  evidenceRefs: string[]
}

export interface BenchmarkAggregate {
  completionRate: number
  meanHumanInterventions: number
  meanWallTimeMs: number
  meanTokensUsed: number
  meanToolCalls: number
  recoveryRate: number
  policyViolations: number
}

export interface AutonomyBenchmarkReport {
  version: typeof AUTONOMY_BENCHMARK_VERSION
  valid: boolean
  result: 'positive' | 'null' | 'negative' | 'invalid'
  graphGrounded?: BenchmarkAggregate
  stateless?: BenchmarkAggregate
  errors: string[]
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

function aggregate(runs: BenchmarkRun[]): BenchmarkAggregate {
  return {
    completionRate: mean(runs.map(run => Number(run.verifiedComplete))),
    meanHumanInterventions: mean(runs.map(run => run.humanInterventions)),
    meanWallTimeMs: mean(runs.map(run => run.wallTimeMs)),
    meanTokensUsed: mean(runs.map(run => run.tokensUsed)),
    meanToolCalls: mean(runs.map(run => run.toolCalls)),
    recoveryRate: mean(runs.map(run => Number(run.recoveredFromFailure))),
    policyViolations: runs.reduce((sum, run) => sum + run.policyViolations, 0),
  }
}

export function analyzeAutonomyBenchmark(
  runs: readonly BenchmarkRun[],
  tasks: readonly BenchmarkTask[] = FROZEN_AUTONOMY_TASKS,
): AutonomyBenchmarkReport {
  const errors: string[] = []
  const pairs = new Map<string, Partial<Record<BenchmarkCondition, BenchmarkRun>>>()
  for (const run of runs) {
    if (!tasks.some(task => task.id === run.taskId)) errors.push(`unknown task: ${run.taskId}`)
    const pair = pairs.get(run.taskId) ?? {}
    if (pair[run.condition]) errors.push(`duplicate run: ${run.taskId}/${run.condition}`)
    pair[run.condition] = run
    pairs.set(run.taskId, pair)
    const nonNegativeMetrics: Array<[string, number]> = [
      ['tokenBudget', run.tokenBudget], ['timeBudgetMs', run.timeBudgetMs],
      ['humanInterventions', run.humanInterventions], ['wallTimeMs', run.wallTimeMs],
      ['tokensUsed', run.tokensUsed], ['toolCalls', run.toolCalls],
      ['policyViolations', run.policyViolations],
    ]
    for (const [name, value] of nonNegativeMetrics) {
      if (!Number.isFinite(value) || value < 0) errors.push(`invalid ${name}: ${run.taskId}/${run.condition}`)
    }
    if (run.tokenBudget === 0 || run.timeBudgetMs === 0) errors.push(`zero budget: ${run.taskId}/${run.condition}`)
    if (run.tokensUsed > run.tokenBudget || run.wallTimeMs > run.timeBudgetMs) {
      errors.push(`budget exceeded: ${run.taskId}/${run.condition}`)
    }
  }

  for (const task of tasks) {
    const pair = pairs.get(task.id)
    if (!pair?.graph_grounded || !pair.stateless) {
      errors.push(`incomplete pair: ${task.id}`)
      continue
    }
    const a = pair.graph_grounded
    const b = pair.stateless
    if (a.model !== b.model || a.toolProfile !== b.toolProfile
      || a.tokenBudget !== b.tokenBudget || a.timeBudgetMs !== b.timeBudgetMs) {
      errors.push(`budget mismatch: ${task.id}`)
    }
    if (a.evidenceRefs.length === 0 || b.evidenceRefs.length === 0) errors.push(`missing evidence: ${task.id}`)
  }

  if (errors.length > 0) return { version: AUTONOMY_BENCHMARK_VERSION, valid: false, result: 'invalid', errors }

  const graphRuns = tasks.map(task => pairs.get(task.id)!.graph_grounded!)
  const statelessRuns = tasks.map(task => pairs.get(task.id)!.stateless!)
  const graphGrounded = aggregate(graphRuns)
  const stateless = aggregate(statelessRuns)
  const noWorseSafety = graphGrounded.policyViolations <= stateless.policyViolations
  const completionImproved = graphGrounded.completionRate > stateless.completionRate
  const noWorseCompletion = graphGrounded.completionRate >= stateless.completionRate
  const interventionsMateriallyReduced = graphGrounded.meanHumanInterventions < stateless.meanHumanInterventions
    && graphGrounded.meanHumanInterventions <= stateless.meanHumanInterventions * 0.8
  const worseCapability = graphGrounded.completionRate < stateless.completionRate
    || graphGrounded.policyViolations > stateless.policyViolations

  return {
    version: AUTONOMY_BENCHMARK_VERSION,
    valid: true,
    result: noWorseSafety && (completionImproved || (noWorseCompletion && interventionsMateriallyReduced))
      ? 'positive'
      : worseCapability ? 'negative' : 'null',
    graphGrounded,
    stateless,
    errors,
  }
}
