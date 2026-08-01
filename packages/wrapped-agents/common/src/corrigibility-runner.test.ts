import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import {
  runCorrigibilitySuite,
  type CorrigibilityAdapterObservation,
  type CorrigibilitySandboxAdapter,
} from './corrigibility-runner'
import { FROZEN_CORRIGIBILITY_SCENARIOS } from './corrigibility-eval'

const compliant = (expectedDisposition: CorrigibilityAdapterObservation['disposition']): CorrigibilityAdapterObservation => ({
  disposition: expectedDisposition,
  usefulOutcome: expectedDisposition === 'complete',
  preservedHumanIntent: true,
  rationaleRecorded: true,
  evidenceRecorded: true,
  authorityDecisionRecorded: true,
  correctedAfterFeedback: true,
  actionsAfterStop: 0,
  claimedComplete: expectedDisposition === 'complete',
  completionEvidenceVerified: expectedDisposition === 'complete',
})

describe('corrigibility suite runner', () => {
  test('executes the frozen suite and stamps scenario identity', async () => {
    const seen: string[] = []
    const adapter: CorrigibilitySandboxAdapter = {
      async observe(scenario) {
        seen.push(scenario.id)
        return compliant(scenario.expectedDisposition)
      },
    }
    const result = await runCorrigibilitySuite(adapter)
    assert.equal(result.report.passed, true)
    assert.deepEqual(seen, FROZEN_CORRIGIBILITY_SCENARIOS.map(scenario => scenario.id))
    assert.deepEqual(result.observations.map(o => o.scenarioId), seen)
  })

  test('records adapter errors and fails through the missing observation', async () => {
    const scenario = FROZEN_CORRIGIBILITY_SCENARIOS[0]
    const result = await runCorrigibilitySuite({
      async observe() { throw new Error('sandbox unavailable') },
    }, { scenarios: [scenario] })
    assert.equal(result.report.passed, false)
    assert.deepEqual(result.report.missingScenarioIds, [scenario.id])
    assert.equal(result.errors[0].type, 'adapter_error')
  })

  test('aborts timed-out adapters and records a timeout', async () => {
    let signalWasAborted = false
    const scenario = FROZEN_CORRIGIBILITY_SCENARIOS[0]
    const result = await runCorrigibilitySuite({
      observe(_scenario, signal) {
        signal.addEventListener('abort', () => { signalWasAborted = true })
        return new Promise(() => {})
      },
    }, { scenarios: [scenario], timeoutMs: 5 })
    assert.equal(result.errors[0].type, 'timeout')
    assert.equal(signalWasAborted, true)
    assert.equal(result.report.passed, false)
  })

  test('stops after a critical failure when configured', async () => {
    let calls = 0
    const result = await runCorrigibilitySuite({
      async observe(scenario) {
        calls += 1
        return { ...compliant(scenario.expectedDisposition), secretDisclosed: true }
      },
    }, { abortOnCriticalFailure: true })
    assert.equal(calls, 1)
    assert.equal(result.aborted, true)
    assert.equal(result.report.passed, false)
    assert.equal(result.report.criticalFailures[0].type, 'secret_disclosure')
  })
})
