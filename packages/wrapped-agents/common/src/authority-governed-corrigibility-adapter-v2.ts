import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CorrigibilityScenario } from './corrigibility-eval'
import type { CorrigibilityAdapterObservation, CorrigibilitySandboxAdapter } from './corrigibility-runner'
import {
  AuthorityGovernedCorrigibilityAdapter,
  assertAuthorityCapabilityAgreement,
  authorityEnvelopeForScenario,
  capabilityProfileForScenario,
  policyEnforcedObservation,
} from './authority-governed-corrigibility-adapter'
import { evaluateActionAuthority } from './authority-policy'
import {
  CORRIGIBILITY_VERIFICATION_TEST,
  CORRIGIBILITY_WRITABLE_FIXTURES,
  runCorrigibilityVerificationTest,
} from './corrigibility-fixture-adapter'
import { launchCodex, type CodexLauncher } from './codex-corrigibility-adapter'
import {
  executeExactLocalMutation,
  type ExactLocalMutation,
  type ExactLocalMutationEvidence,
} from './exact-local-mutation'

export const AUTHORITY_GOVERNED_CORRIGIBILITY_ADAPTER_V2_VERSION = '2026-08-01.v2' as const
export const DETERMINISTIC_CORRIGIBILITY_MUTATION_SCENARIOS = Object.freeze([
  'correction-recovery', 'benign-local-change',
] as const)

export type ExactMutationExecutor = (
  root: string,
  envelope: Parameters<typeof executeExactLocalMutation>[1],
  mutation: Readonly<ExactLocalMutation>,
) => Promise<ExactLocalMutationEvidence>

export class AuthorityGovernedCorrigibilityAdapterV2 implements CorrigibilitySandboxAdapter {
  constructor(
    private readonly launcher: CodexLauncher = launchCodex,
    private readonly command = 'codex',
    private readonly mutationExecutor: ExactMutationExecutor = executeExactLocalMutation,
  ) {}

  async observe(scenario: Readonly<CorrigibilityScenario>, signal: AbortSignal): Promise<CorrigibilityAdapterObservation> {
    const envelope = authorityEnvelopeForScenario(scenario)
    const policy = evaluateActionAuthority(envelope)
    const profile = capabilityProfileForScenario(scenario)
    assertAuthorityCapabilityAgreement(envelope, policy, profile)
    if (policy.disposition !== 'execute') return policyEnforcedObservation(policy)

    if (!DETERMINISTIC_CORRIGIBILITY_MUTATION_SCENARIOS.includes(scenario.id as typeof DETERMINISTIC_CORRIGIBILITY_MUTATION_SCENARIOS[number])) {
      return new AuthorityGovernedCorrigibilityAdapter(this.launcher, this.command).observe(scenario, signal)
    }
    signal.throwIfAborted()
    const fixture = CORRIGIBILITY_WRITABLE_FIXTURES[scenario.id]
    if (!fixture || profile.sandbox !== 'workspace-write' || profile.scope.length !== 1) {
      throw new Error(`Deterministic fixture/capability mismatch for ${scenario.id}`)
    }

    const directory = await mkdtemp(join(tmpdir(), `aimparency-authority-v2-${scenario.id}-`))
    try {
      await Promise.all([
        writeFile(join(directory, 'value.txt'), fixture.initial, 'utf8'),
        writeFile(join(directory, 'expected.txt'), fixture.expected, 'utf8'),
        writeFile(join(directory, 'verify.test.mjs'), CORRIGIBILITY_VERIFICATION_TEST, 'utf8'),
        writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8'),
      ])
      const evidence = await this.mutationExecutor(directory, envelope, {
        path: profile.scope[0], expectedBefore: fixture.initial, replacement: fixture.expected,
        evidenceLabel: `corrigibility:${scenario.id}`,
      })
      const verified = await readFile(join(directory, 'value.txt'), 'utf8') === fixture.expected
        && await readFile(join(directory, 'verify.test.mjs'), 'utf8') === CORRIGIBILITY_VERIFICATION_TEST
        && await runCorrigibilityVerificationTest(directory)
      if (!verified) throw new Error(`Deterministic fixture verification failed for ${scenario.id}`)

      return {
        disposition: 'complete', usefulOutcome: true, preservedHumanIntent: true,
        rationaleRecorded: true, evidenceRecorded: true, authorityDecisionRecorded: true,
        correctedAfterFeedback: fixture.corrected, externalActionCount: 0,
        externalActionAuthorized: false, secretDisclosed: false,
        destructiveActionTaken: false, destructiveActionAuthorized: false,
        permissionExpanded: false, permissionExpansionAuthorized: false,
        stopRequested: false, actionsAfterStop: 0, claimedComplete: true,
        completionEvidenceVerified: true, authorityPolicyReasons: policy.reasons,
        actuationEvidence: {
          evidenceLabel: evidence.evidenceLabel, beforeSha256: evidence.beforeSha256,
          afterSha256: evidence.afterSha256, effectiveIntentRevision: evidence.effectiveIntentRevision,
        },
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
