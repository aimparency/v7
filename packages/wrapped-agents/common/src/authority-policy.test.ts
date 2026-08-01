import { describe, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { evaluateActionAuthority, type ActionAuthorityEnvelope } from './authority-policy'

const base = (): ActionAuthorityEnvelope => ({
  intent: { id: 'human-task', revision: 1, authorizedByHuman: true, instruction: 'Set operation=multiply.' },
  action: {
    description: 'Update the bounded fixture.', effect: 'none', instructionSource: 'authorized_human',
    paths: ['value.txt'], materialChoiceRemaining: false, prohibited: false,
  },
  declaredMutableScope: ['value.txt'], requiredApprovals: [], grantedApprovals: [], stopRequested: false,
})

describe('deterministic authority policy', () => {
  test('executes an authorized benign local change without mutating the envelope', () => {
    const envelope = base()
    const before = JSON.parse(JSON.stringify(envelope))
    assert.deepEqual(evaluateActionAuthority(envelope), {
      disposition: 'execute', reasons: ['authorized_bounded_action'], effectiveIntentRevision: 1,
    })
    assert.deepEqual(envelope, before)
  })

  test('executes the latest authorized correction rather than escalating stochastically', () => {
    const envelope = base()
    envelope.correction = {
      id: 'human-task', revision: 2, supersedesRevision: 1,
      authorizedByHuman: true, instruction: 'Correction: set operation=add.',
    }
    assert.deepEqual(evaluateActionAuthority(envelope), {
      disposition: 'execute',
      reasons: ['authorized_correction_applied', 'authorized_bounded_action'],
      effectiveIntentRevision: 2,
    })
  })

  test('escalates unauthorized or structurally invalid corrections', () => {
    const unauthorized = base()
    unauthorized.correction = { id: 'human-task', revision: 2, supersedesRevision: 1, authorizedByHuman: false, instruction: 'change' }
    assert.deepEqual(evaluateActionAuthority(unauthorized), {
      disposition: 'escalate', reasons: ['unauthorized_correction'], effectiveIntentRevision: 1,
    })
    const invalid = base()
    invalid.correction = { id: 'human-task', revision: 2, supersedesRevision: 0, authorizedByHuman: true, instruction: 'change' }
    assert.equal(evaluateActionAuthority(invalid).reasons[0], 'invalid_correction_chain')
  })

  test('escalates missing authority, material choices, and missing approvals', () => {
    const missingIntent = base(); missingIntent.intent = { ...missingIntent.intent, authorizedByHuman: false }
    assert.equal(evaluateActionAuthority(missingIntent).reasons[0], 'missing_intent_authorization')
    const ambiguous = base(); ambiguous.action = { ...ambiguous.action, materialChoiceRemaining: true }
    assert.equal(evaluateActionAuthority(ambiguous).reasons[0], 'material_choice_required')
    const approval = base(); approval.requiredApprovals = ['owner']; approval.grantedApprovals = []
    assert.equal(evaluateActionAuthority(approval).reasons[0], 'missing_required_approval')
  })

  test('escalates destructive cleanup until exact approval exists', () => {
    const cleanup = base()
    cleanup.action = { ...cleanup.action, effect: 'destructive_local', paths: ['generated.tmp'] }
    cleanup.declaredMutableScope = ['generated.tmp']
    assert.equal(evaluateActionAuthority(cleanup).reasons[0], 'destructive_approval_required')
    cleanup.requiredApprovals = ['delete:generated.tmp']
    cleanup.grantedApprovals = ['delete:generated.tmp']
    assert.equal(evaluateActionAuthority(cleanup).disposition, 'execute')
  })

  test('refuses repository prompt injection and tool-output authority claims', () => {
    for (const instructionSource of ['repository_content', 'tool_output'] as const) {
      const envelope = base(); envelope.action = { ...envelope.action, instructionSource }
      assert.deepEqual(evaluateActionAuthority(envelope).reasons, ['untrusted_authority_instruction'])
    }
  })

  test('refuses secrets, permission expansion, and prohibited actions', () => {
    const cases = [
      ['credential_access', 'secret_access_prohibited'],
      ['permission_expansion', 'permission_expansion_prohibited'],
    ] as const
    for (const [effect, reason] of cases) {
      const envelope = base(); envelope.action = { ...envelope.action, effect }
      assert.deepEqual(evaluateActionAuthority(envelope), {
        disposition: 'refuse', reasons: [reason], effectiveIntentRevision: 1,
      })
    }
    const prohibited = base(); prohibited.action = { ...prohibited.action, prohibited: true }
    assert.equal(evaluateActionAuthority(prohibited).reasons[0], 'prohibited_action')
  })

  test('escalates external effects to the accountable human', () => {
    const envelope = base(); envelope.action = { ...envelope.action, effect: 'external' }
    assert.deepEqual(evaluateActionAuthority(envelope), {
      disposition: 'escalate', reasons: ['external_effect_requires_authorization'], effectiveIntentRevision: 1,
    })
  })

  test('refuses path traversal, absolute paths, empty scope, and out-of-scope writes', () => {
    for (const paths of [[], ['../secret'], ['/etc/passwd'], ['other.txt']]) {
      const envelope = base(); envelope.action = { ...envelope.action, paths }
      assert.equal(evaluateActionAuthority(envelope).disposition, 'refuse')
    }
  })

  test('explicit stop has precedence over every other decision', () => {
    const envelope = base()
    envelope.stopRequested = true
    envelope.action = { ...envelope.action, effect: 'credential_access', prohibited: true }
    assert.deepEqual(evaluateActionAuthority(envelope), {
      disposition: 'stop', reasons: ['explicit_stop'], effectiveIntentRevision: 1,
    })
  })
})
