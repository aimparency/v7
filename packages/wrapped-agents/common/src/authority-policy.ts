export type AuthorityDisposition = 'execute' | 'refuse' | 'escalate' | 'stop'
export type ActionEffect = 'none' | 'destructive_local' | 'external' | 'credential_access' | 'permission_expansion'
export type InstructionSource = 'authorized_human' | 'repository_content' | 'tool_output'

export interface HumanIntentRevision {
  id: string
  revision: number
  authorizedByHuman: boolean
  instruction: string
}

export interface HumanIntentCorrection extends HumanIntentRevision {
  supersedesRevision: number
}

export interface RequestedBoundedAction {
  description: string
  effect: ActionEffect
  instructionSource: InstructionSource
  paths: readonly string[]
  materialChoiceRemaining: boolean
  prohibited: boolean
}

export interface ActionAuthorityEnvelope {
  intent: Readonly<HumanIntentRevision>
  correction?: Readonly<HumanIntentCorrection>
  action: Readonly<RequestedBoundedAction>
  declaredMutableScope: readonly string[]
  requiredApprovals: readonly string[]
  grantedApprovals: readonly string[]
  stopRequested: boolean
}

export type AuthorityReason =
  | 'explicit_stop'
  | 'prohibited_action'
  | 'untrusted_authority_instruction'
  | 'secret_access_prohibited'
  | 'permission_expansion_prohibited'
  | 'external_effect_requires_authorization'
  | 'invalid_scope'
  | 'outside_declared_scope'
  | 'missing_intent_authorization'
  | 'unauthorized_correction'
  | 'invalid_correction_chain'
  | 'material_choice_required'
  | 'destructive_approval_required'
  | 'missing_required_approval'
  | 'authorized_correction_applied'
  | 'authorized_bounded_action'

export interface AuthorityPolicyDecision {
  disposition: AuthorityDisposition
  reasons: readonly AuthorityReason[]
  effectiveIntentRevision: number
}

const decision = (
  disposition: AuthorityDisposition,
  reasons: readonly AuthorityReason[],
  revision: number,
): AuthorityPolicyDecision => ({ disposition, reasons, effectiveIntentRevision: revision })

const validRelativePath = (path: string): boolean => path.length > 0
  && !path.startsWith('/')
  && !path.split('/').includes('..')

export function evaluateActionAuthority(envelope: Readonly<ActionAuthorityEnvelope>): AuthorityPolicyDecision {
  const { action, correction, intent } = envelope
  let revision = intent.revision

  if (envelope.stopRequested) return decision('stop', ['explicit_stop'], revision)
  if (action.prohibited) return decision('refuse', ['prohibited_action'], revision)
  if (action.instructionSource !== 'authorized_human') {
    return decision('refuse', ['untrusted_authority_instruction'], revision)
  }
  if (action.effect === 'credential_access') return decision('refuse', ['secret_access_prohibited'], revision)
  if (action.effect === 'permission_expansion') return decision('refuse', ['permission_expansion_prohibited'], revision)
  if (action.effect === 'external') return decision('escalate', ['external_effect_requires_authorization'], revision)
  if (action.paths.length === 0 || action.paths.some(path => !validRelativePath(path))) {
    return decision('refuse', ['invalid_scope'], revision)
  }
  if (action.paths.some(path => !envelope.declaredMutableScope.includes(path))) {
    return decision('refuse', ['outside_declared_scope'], revision)
  }

  if (!intent.authorizedByHuman) return decision('escalate', ['missing_intent_authorization'], revision)
  const reasons: AuthorityReason[] = []
  if (correction) {
    if (!correction.authorizedByHuman) return decision('escalate', ['unauthorized_correction'], revision)
    if (correction.supersedesRevision !== intent.revision || correction.revision <= intent.revision) {
      return decision('escalate', ['invalid_correction_chain'], revision)
    }
    revision = correction.revision
    reasons.push('authorized_correction_applied')
  }
  if (action.materialChoiceRemaining) return decision('escalate', ['material_choice_required'], revision)
  if (action.effect === 'destructive_local' && envelope.requiredApprovals.length === 0) {
    return decision('escalate', ['destructive_approval_required'], revision)
  }
  if (envelope.requiredApprovals.some(approval => !envelope.grantedApprovals.includes(approval))) {
    return decision('escalate', ['missing_required_approval'], revision)
  }

  return decision('execute', [...reasons, 'authorized_bounded_action'], revision)
}
