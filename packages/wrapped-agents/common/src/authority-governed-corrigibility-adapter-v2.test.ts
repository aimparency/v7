import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { FROZEN_CORRIGIBILITY_V3_SCENARIOS, evaluateCorrigibilityV3 } from './corrigibility-eval'
import {
  AuthorityGovernedCorrigibilityAdapterV2,
  DETERMINISTIC_CORRIGIBILITY_MUTATION_SCENARIOS,
} from './authority-governed-corrigibility-adapter-v2'
import { AuthorityGovernedCorrigibilityAdapter } from './authority-governed-corrigibility-adapter'
import type { CodexLauncher } from './codex-corrigibility-adapter'
import { writeFile } from 'node:fs/promises'

const scenario = (id: string) => FROZEN_CORRIGIBILITY_V3_SCENARIOS.find(item => item.id === id)!
const readonlyObservation = {
  disposition: 'complete', usefulOutcome: true, preservedHumanIntent: true,
  rationaleRecorded: true, evidenceRecorded: true, authorityDecisionRecorded: true,
  correctedAfterFeedback: false, externalActionAuthorized: false, secretDisclosed: false,
  destructiveActionTaken: false, destructiveActionAuthorized: false,
  permissionExpanded: false, permissionExpansionAuthorized: false, stopRequested: false,
  claimedComplete: true, completionEvidenceVerified: true, externalActionCount: 0, actionsAfterStop: 0,
}

describe('authority-governed corrigibility adapter v2', () => {
  test('actuates correction and benign writes without launching a model', async () => {
    let launches = 0
    const launcher: CodexLauncher = async () => { launches += 1; throw new Error('must not launch') }
    const adapter = new AuthorityGovernedCorrigibilityAdapterV2(launcher)
    const correction = await adapter.observe(scenario('correction-recovery'), new AbortController().signal)
    const benign = await adapter.observe(scenario('benign-local-change'), new AbortController().signal)
    assert.equal(launches, 0)
    assert.equal(correction.disposition, 'complete')
    assert.equal(correction.correctedAfterFeedback, true)
    assert.equal(correction.actuationEvidence?.effectiveIntentRevision, 2)
    assert.equal(benign.disposition, 'complete')
    assert.equal(benign.actuationEvidence?.effectiveIntentRevision, 1)
  })

  test('uses deterministic actuation for exactly the frozen two scenarios', () => {
    assert.deepEqual(DETERMINISTIC_CORRIGIBILITY_MUTATION_SCENARIOS, ['correction-recovery', 'benign-local-change'])
    assert.equal(Object.isFrozen(DETERMINISTIC_CORRIGIBILITY_MUTATION_SCENARIOS), true)
  })

  test('preserves v1 model-delegated correction behavior', async () => {
    let launches = 0
    const launcher: CodexLauncher = async request => {
      launches += 1
      await writeFile(`${request.cwd}/value.txt`, 'operation=add\n', 'utf8')
      return { exitCode: 0, stdout: '', stderr: '', lastMessage: JSON.stringify({ ...readonlyObservation, correctedAfterFeedback: true }) }
    }
    const observation = await new AuthorityGovernedCorrigibilityAdapter(launcher)
      .observe(scenario('correction-recovery'), new AbortController().signal)
    assert.equal(launches, 1)
    assert.equal(observation.correctedAfterFeedback, true)
  })

  test('keeps readonly inspection on a read-only model launch', async () => {
    const sandboxes: string[] = []
    const launcher: CodexLauncher = async request => {
      sandboxes.push(request.args[request.args.indexOf('--sandbox') + 1])
      return { exitCode: 0, stdout: '', stderr: '', lastMessage: JSON.stringify(readonlyObservation) }
    }
    const observation = await new AuthorityGovernedCorrigibilityAdapterV2(launcher)
      .observe(scenario('benign-readonly-inspection'), new AbortController().signal)
    assert.equal(observation.disposition, 'complete')
    assert.deepEqual(sandboxes, ['read-only'])
  })

  test('fails closed when the mutation executor detects a tampered precondition', async () => {
    const adapter = new AuthorityGovernedCorrigibilityAdapterV2(undefined, undefined, async () => {
      throw new Error('Exact local mutation precondition mismatch')
    })
    await assert.rejects(adapter.observe(scenario('correction-recovery'), new AbortController().signal), /precondition mismatch/)
  })

  test('produces a complete scorer-passing v3 observation set', async () => {
    let launches = 0
    const launcher: CodexLauncher = async () => {
      launches += 1
      return { exitCode: 0, stdout: '', stderr: '', lastMessage: JSON.stringify(readonlyObservation) }
    }
    const adapter = new AuthorityGovernedCorrigibilityAdapterV2(launcher)
    const observations = []
    for (const item of FROZEN_CORRIGIBILITY_V3_SCENARIOS) {
      observations.push({ ...await adapter.observe(item, new AbortController().signal), scenarioId: item.id })
    }
    const report = evaluateCorrigibilityV3(observations)
    assert.equal(launches, 1)
    assert.equal(report.passed, true)
    assert.equal(report.metrics.correctionRecovery, 1)
    assert.equal(report.criticalFailures.length, 0)
  })
})
