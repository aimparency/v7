/**
 * Declarative State Machine Definition
 *
 * Actions are defined as const objects, states reference them with target states.
 * Prompts are generated dynamically from this definition.
 */

export interface ActionParameter {
  name: string
  description: string
  required: boolean
}

export interface Action {
  name: string
  description: string  // When to use this action
  parameters: ActionParameter[]
  examples: string[]  // JSON examples (up to 3)
}

export interface StateAction {
  action: Action
  targetState: string  // State to transition to after this action
}

export interface State {
  name: string
  instructions: string  // State-specific guidance for supervisor
  color: string  // Pastel color as #hex for UI display
  actions: StateAction[]
}

// ========== ACTION DEFINITIONS ==========

export const startWork: Action = {
  name: 'start_work',
  description: 'Begin working on a specific aim. Use when you find an open aim that needs implementation.',
  parameters: [
    { name: 'aim_id', description: 'UUID of the aim to work on', required: true },
    { name: 'aim_text', description: 'Text description of the aim', required: true },
    { name: 'strategy', description: 'Approach to take for implementing this aim', required: true }
  ],
  examples: [
    '{"action": {"type": "start_work", "aim_id": "abc-123", "aim_text": "Add unit tests for auth module", "strategy": "Write Jest tests covering login, logout, and token refresh"}}',
    '{"action": {"type": "start_work", "aim_id": "def-456", "aim_text": "Implement dark mode toggle", "strategy": "Add CSS variables for theming and toggle component"}}'
  ]
}

export const breakDown: Action = {
  name: 'break_down',
  description: 'Decompose a complex aim into smaller sub-aims. Use when an aim is too large to implement directly.',
  parameters: [
    { name: 'aim_id', description: 'UUID of the aim to break down into sub-aims', required: true },
    { name: 'reason', description: 'Why this aim needs to be broken down', required: true }
  ],
  examples: [
    '{"action": {"type": "break_down", "aim_id": "abc-123", "reason": "This aim is too complex, needs to be split into smaller tasks"}}',
    '{"action": {"type": "break_down", "aim_id": "complex-feature", "reason": "Unclear how to implement, need to break into concrete steps"}}'
  ]
}

export const ideate: Action = {
  name: 'ideate',
  description: 'Generate new aims through research, codebase review, or improvements. Use when no obvious work exists.',
  parameters: [
    { name: 'approach', description: 'How to ideate: "web_research" (research topics online), "codebase_scan" (review code for improvements), "review_recent" (analyze recent work for next steps)', required: true }
  ],
  examples: [
    '{"action": {"type": "ideate", "approach": "web_research"}}',
    '{"action": {"type": "ideate", "approach": "codebase_scan"}}',
    '{"action": {"type": "ideate", "approach": "review_recent"}}'
  ]
}

export const wait: Action = {
  name: 'wait',
  description: 'Do nothing right now. Use when there is truly no work available and ideation is not appropriate.',
  parameters: [
    { name: 'reason', description: 'Why waiting (e.g., "no open aims", "all aims blocked")', required: true }
  ],
  examples: [
    '{"action": {"type": "wait", "reason": "no open aims available"}}',
    '{"action": {"type": "wait", "reason": "all aims are blocked by dependencies"}}'
  ]
}

export const proceed: Action = {
  name: 'proceed',
  description: 'Continue working. Send guidance, select options, or just monitor progress.',
  parameters: [
    { name: 'mode', description: '"monitor" (just watch), "nudge" (send encouraging text), "select" (choose menu option), "escalate" (ask human)', required: true },
    { name: 'text', description: 'Text to send (only for mode=nudge)', required: false },
    { name: 'choice', description: 'Option to select: number or letter (only for mode=select)', required: false },
    { name: 'question', description: 'Question for human (only for mode=escalate)', required: false }
  ],
  examples: [
    '{"action": {"type": "proceed", "mode": "monitor"}}',
    '{"action": {"type": "proceed", "mode": "nudge", "text": "Looking good, keep going!"}}',
    '{"action": {"type": "proceed", "mode": "select", "choice": "1"}}'
  ]
}

export const wrapUp: Action = {
  name: 'wrap_up',
  description: 'Work appears complete. Transition to verification. Use when the aim implementation looks done.',
  parameters: [
    { name: 'summary', description: 'Brief summary of what was accomplished', required: true }
  ],
  examples: [
    '{"action": {"type": "wrap_up", "summary": "Implemented login form with validation and error handling"}}',
    '{"action": {"type": "wrap_up", "summary": "Added unit tests, all passing"}}'
  ]
}

export const verifyComplete: Action = {
  name: 'verify_complete',
  description: 'Work meets ~80% of requirements (good enough, not perfect). Triggers: verify → commit → reflect → compact → explore.',
  parameters: [
    { name: 'notes', description: 'What looks good about the implementation', required: true }
  ],
  examples: [
    '{"action": {"type": "verify_complete", "notes": "Core functionality works, tests passing, good enough"}}',
    '{"action": {"type": "verify_complete", "notes": "Feature complete as requested, basic validation in place"}}'
  ]
}

export const verifyIncomplete: Action = {
  name: 'verify_incomplete',
  description: 'Work does not meet ~80% threshold. Return to WORKING state with guidance.',
  parameters: [
    { name: 'missing', description: 'What is not complete yet', required: true }
  ],
  examples: [
    '{"action": {"type": "verify_incomplete", "missing": "Tests are failing, need to fix validation logic"}}',
    '{"action": {"type": "verify_incomplete", "missing": "Feature works but missing error handling"}}'
  ]
}

export const retry: Action = {
  name: 'retry',
  description: 'Try to continue from previous state. Use when the worker looks responsive again.',
  parameters: [
    { name: 'reason', description: 'Why retrying is appropriate', required: true }
  ],
  examples: [
    '{"action": {"type": "retry", "reason": "Worker is responding now"}}',
    '{"action": {"type": "retry", "reason": "Timeout was temporary"}}'
  ]
}

export const reset: Action = {
  name: 'reset',
  description: 'Give up on current work, return to EXPLORING. Use when work is stuck.',
  parameters: [
    { name: 'reason', description: 'Why resetting is necessary', required: true }
  ],
  examples: [
    '{"action": {"type": "reset", "reason": "Worker is stuck, start over"}}',
    '{"action": {"type": "reset", "reason": "Too many errors"}}'
  ]
}

export const abort: Action = {
  name: 'abort',
  description: 'Abort and return to EXPLORING. For unrecoverable errors.',
  parameters: [
    { name: 'reason', description: 'Why aborting', required: true }
  ],
  examples: [
    '{"action": {"type": "abort", "reason": "Unrecoverable error"}}',
    '{"action": {"type": "abort", "reason": "Critical failure"}}'
  ]
}

// ========== STATE DEFINITIONS ==========

export const exploring: State = {
  name: 'EXPLORING',
  instructions: 'Take a look at the open aims and see if there is something you can work on. If not, choose a high level aim to break down, or come up with new hypotheses and ideas - maybe browse the web for inspiration.',
  color: '#a8dadc',  // Pastel cyan - exploring, discovering
  actions: [
    { action: startWork, targetState: 'WORKING' },
    { action: breakDown, targetState: 'EXPLORING' },
    { action: ideate, targetState: 'EXPLORING' },
    { action: wait, targetState: 'EXPLORING' }
  ]
}

export const working: State = {
  name: 'WORKING',
  instructions: 'Actively working on an aim. Monitor progress and help the worker complete the task. When the work looks complete, use wrap_up to begin verification.',
  color: '#a8e6a3',  // Pastel green - active work
  actions: [
    { action: proceed, targetState: 'WORKING' },
    { action: wrapUp, targetState: 'WRAPPING_UP' }
  ]
}

export const wrappingUp: State = {
  name: 'WRAPPING_UP',
  instructions: 'Verify work completion using ~80% threshold (good enough, not perfect). If complete, will trigger commit → reflect → compact → explore. If incomplete, return to working.',
  color: '#ffe5a3',  // Pastel yellow - completion phase
  actions: [
    { action: verifyComplete, targetState: 'EXPLORING' },
    { action: verifyIncomplete, targetState: 'WORKING' }
  ]
}

export const errorState: State = {
  name: 'ERROR',
  instructions: 'Error occurred (timeout, parse failure, etc.). Exponential backoff active. Decide whether to retry, reset, or abort.',
  color: '#ffb3ba',  // Pastel red/pink - error state
  actions: [
    { action: retry, targetState: 'PREVIOUS' },  // Special: returns to previous state
    { action: reset, targetState: 'EXPLORING' },
    { action: abort, targetState: 'EXPLORING' }
  ]
}

// ========== STATE MACHINE ==========

export const STATE_MACHINE: Record<string, State> = {
  EXPLORING: exploring,
  WORKING: working,
  WRAPPING_UP: wrappingUp,
  ERROR: errorState
}

// ========== HELPER FUNCTIONS ==========

export function getState(stateName: string): State | undefined {
  return STATE_MACHINE[stateName]
}

export function getValidActionNames(stateName: string): string[] {
  const state = getState(stateName)
  return state?.actions.map(sa => sa.action.name) || []
}

export function isValidActionForState(stateName: string, actionName: string): boolean {
  return getValidActionNames(stateName).includes(actionName)
}

export function getTargetState(stateName: string, actionName: string): string | undefined {
  const state = getState(stateName)
  const stateAction = state?.actions.find(sa => sa.action.name === actionName)
  return stateAction?.targetState
}
