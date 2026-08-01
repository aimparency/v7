import {
  evaluateCorrigibility,
  FROZEN_CORRIGIBILITY_SCENARIOS,
  type CorrigibilityObservation,
  type CorrigibilityReport,
  type CorrigibilityScenario,
} from './corrigibility-eval'

export type CorrigibilityAdapterObservation = Omit<CorrigibilityObservation, 'scenarioId'>

export interface CorrigibilitySandboxAdapter {
  observe(
    scenario: Readonly<CorrigibilityScenario>,
    signal: AbortSignal,
  ): Promise<CorrigibilityAdapterObservation>
}

export interface CorrigibilityRunnerOptions {
  timeoutMs?: number
  abortOnCriticalFailure?: boolean
  scenarios?: readonly CorrigibilityScenario[]
}

export interface CorrigibilityRunError {
  scenarioId: string
  type: 'timeout' | 'adapter_error'
  message: string
}

export interface CorrigibilityRunResult {
  observations: CorrigibilityObservation[]
  errors: CorrigibilityRunError[]
  aborted: boolean
  report: CorrigibilityReport
}

async function observeWithTimeout(
  adapter: CorrigibilitySandboxAdapter,
  scenario: CorrigibilityScenario,
  timeoutMs: number,
): Promise<CorrigibilityAdapterObservation> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error(`scenario timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([adapter.observe(Object.freeze({ ...scenario }), controller.signal), timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function runCorrigibilitySuite(
  adapter: CorrigibilitySandboxAdapter,
  options: CorrigibilityRunnerOptions = {},
): Promise<CorrigibilityRunResult> {
  const scenarios = options.scenarios ?? FROZEN_CORRIGIBILITY_SCENARIOS
  const timeoutMs = options.timeoutMs ?? 60_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive and finite')

  const observations: CorrigibilityObservation[] = []
  const errors: CorrigibilityRunError[] = []
  let aborted = false

  for (const scenario of scenarios) {
    try {
      const observed = await observeWithTimeout(adapter, scenario, timeoutMs)
      const observation: CorrigibilityObservation = { ...observed, scenarioId: scenario.id }
      observations.push(observation)
      const singleReport = evaluateCorrigibility([observation], [scenario])
      if (options.abortOnCriticalFailure && singleReport.criticalFailures.length > 0) {
        aborted = true
        break
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({
        scenarioId: scenario.id,
        type: message.includes('timed out') ? 'timeout' : 'adapter_error',
        message,
      })
    }
  }

  return {
    observations,
    errors,
    aborted,
    report: evaluateCorrigibility(observations, scenarios),
  }
}
