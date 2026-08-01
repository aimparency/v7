import type { AuthorityDisposition, AuthorityReason } from './authority-policy'

export interface SupervisorDispatchDecision {
  disposition: AuthorityDisposition
  reasons: readonly AuthorityReason[]
}

const ORCHESTRATION_ACTIONS = new Set([
  'start_work',
  'break_down',
  'ideate',
  'text_prompt',
  'verify',
  'revisit',
  'wrap_up',
  'commit',
  'compact',
  'waiting_for_committed',
  'explore',
  'retry',
  'wait',
  // Legacy action names retained by WatchdogService.executeAction.
  'send-prompt',
  'wrap-up',
])

const TERMINAL_INPUT_ACTIONS = new Set(['choice', 'select-option', 'enter'])
const STOP_ACTIONS = new Set(['stop', 'emergency-stop'])
const MAX_WAIT_DURATION_MS = 60_000

/**
 * Authorize an action emitted by the stochastic supervisor before it can
 * mutate supervisor state or write to the worker PTY.
 *
 * Orchestration messages carry no capability by themselves and remain
 * available. Opaque terminal input is fail-closed: a visible menu may be a
 * permission, credential, destructive-action, or other material prompt, and a
 * bare key/number does not encode enough authority to decide safely.
 */
export function evaluateSupervisorDispatch(action: unknown): SupervisorDispatchDecision {
  if (!action || typeof action !== 'object') {
    return { disposition: 'refuse', reasons: ['prohibited_action'] }
  }

  const type = (action as { type?: unknown }).type
  if (typeof type !== 'string') {
    return { disposition: 'refuse', reasons: ['prohibited_action'] }
  }
  if (STOP_ACTIONS.has(type)) {
    return { disposition: 'stop', reasons: ['explicit_stop'] }
  }
  if (TERMINAL_INPUT_ACTIONS.has(type)) {
    return { disposition: 'escalate', reasons: ['material_choice_required'] }
  }
  if (ORCHESTRATION_ACTIONS.has(type)) {
    return { disposition: 'execute', reasons: ['authorized_bounded_action'] }
  }
  return { disposition: 'refuse', reasons: ['prohibited_action'] }
}

export function supervisorDispatchAllowed(decision: Readonly<SupervisorDispatchDecision>): boolean {
  return decision.disposition === 'execute' || decision.disposition === 'stop'
}

/**
 * Remove semantic payloads authored by the supervisor model. The action type
 * selects a trusted local executor and its canonical prompt; it does not grant
 * authority to relay terminal/repository text into the capable worker.
 */
export function canonicalizeSupervisorAction(action: unknown): Readonly<Record<string, unknown>> {
  if (!action || typeof action !== 'object') return {}
  const raw = action as Record<string, unknown>
  if (typeof raw.type !== 'string') return {}

  if (raw.type === 'wait' && typeof raw.duration === 'number' && Number.isFinite(raw.duration)) {
    return {
      type: raw.type,
      duration: Math.min(MAX_WAIT_DURATION_MS, Math.max(1_000, Math.trunc(raw.duration))),
    }
  }
  if (raw.type === 'send-prompt') {
    return { type: raw.type, instruct: raw.instruct === true }
  }
  return { type: raw.type }
}
