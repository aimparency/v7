import {
  analyzeAutonomyBenchmark,
  FROZEN_AUTONOMY_TASKS,
  type AutonomyBenchmarkReport,
  type BenchmarkCondition,
  type BenchmarkRun,
  type BenchmarkTask,
} from './autonomy-benchmark'

export type BenchmarkRunOutcome = Omit<
  BenchmarkRun,
  'taskId' | 'condition' | 'model' | 'toolProfile' | 'tokenBudget' | 'timeBudgetMs'
>

export interface AutonomyBenchmarkAdapter {
  execute(input: {
    task: Readonly<BenchmarkTask>
    condition: BenchmarkCondition
    model: string
    toolProfile: string
    tokenBudget: number
    timeBudgetMs: number
    signal: AbortSignal
  }): Promise<BenchmarkRunOutcome>
}

export interface AutonomyBenchmarkRunnerOptions {
  model: string
  toolProfile: string
  tokenBudget: number
  timeBudgetMs: number
  tasks?: readonly BenchmarkTask[]
  orderPair?: (task: Readonly<BenchmarkTask>, index: number) => readonly BenchmarkCondition[]
}

export interface AutonomyBenchmarkRunError {
  taskId: string
  condition: BenchmarkCondition
  type: 'timeout' | 'adapter_error'
  message: string
}

export interface AutonomyBenchmarkRunResult {
  runs: BenchmarkRun[]
  errors: AutonomyBenchmarkRunError[]
  report: AutonomyBenchmarkReport
}

const DEFAULT_ORDER: readonly BenchmarkCondition[] = ['graph_grounded', 'stateless']

function assertOptions(options: AutonomyBenchmarkRunnerOptions): void {
  if (!options.model.trim()) throw new Error('model is required')
  if (!options.toolProfile.trim()) throw new Error('toolProfile is required')
  if (!Number.isFinite(options.tokenBudget) || options.tokenBudget <= 0) throw new Error('tokenBudget must be positive and finite')
  if (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs <= 0) throw new Error('timeBudgetMs must be positive and finite')
}

async function executeWithTimeout(
  adapter: AutonomyBenchmarkAdapter,
  input: Parameters<AutonomyBenchmarkAdapter['execute']>[0],
): Promise<BenchmarkRunOutcome> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      input.signal.throwIfAborted()
      reject(new Error(`run timed out after ${input.timeBudgetMs}ms`))
    }, input.timeBudgetMs)
  })
  try {
    return await Promise.race([adapter.execute(input), timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function runAutonomyBenchmark(
  adapter: AutonomyBenchmarkAdapter,
  options: AutonomyBenchmarkRunnerOptions,
): Promise<AutonomyBenchmarkRunResult> {
  assertOptions(options)
  const tasks = options.tasks ?? FROZEN_AUTONOMY_TASKS
  const runs: BenchmarkRun[] = []
  const errors: AutonomyBenchmarkRunError[] = []

  for (const [index, task] of tasks.entries()) {
    const order = options.orderPair?.(Object.freeze({ ...task }), index) ?? DEFAULT_ORDER
    if (order.length !== 2 || new Set(order).size !== 2
      || !order.includes('graph_grounded') || !order.includes('stateless')) {
      throw new Error(`orderPair must return graph_grounded and stateless exactly once for ${task.id}`)
    }
    for (const condition of order) {
      const controller = new AbortController()
      const input = {
        task: Object.freeze({ ...task }), condition, model: options.model,
        toolProfile: options.toolProfile, tokenBudget: options.tokenBudget,
        timeBudgetMs: options.timeBudgetMs, signal: controller.signal,
      }
      try {
        const outcome = await executeWithTimeout(adapter, input)
        runs.push({
          ...outcome,
          taskId: task.id,
          condition,
          model: options.model,
          toolProfile: options.toolProfile,
          tokenBudget: options.tokenBudget,
          timeBudgetMs: options.timeBudgetMs,
        })
      } catch (error) {
        controller.abort()
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ taskId: task.id, condition, type: message.includes('timed out') ? 'timeout' : 'adapter_error', message })
      }
    }
  }

  return { runs, errors, report: analyzeAutonomyBenchmark(runs, tasks) }
}
