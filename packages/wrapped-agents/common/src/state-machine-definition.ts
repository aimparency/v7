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
  description: 'Use when the worker has found something concrete to tackle and should move into execution.',
  parameters: [
    { name: 'task', description: 'Short description of the task to work on', required: true },
    { name: 'strategy', description: 'Optional approach the worker should take', required: false }
  ],
  examples: [
    '{"action": {"type": "start_work", "task": "add unit tests for auth module", "strategy": "cover login, logout, and token refresh"}}',
    '{"action": {"type": "start_work", "task": "implement dark mode toggle"}}'
  ]
}

export const breakDown: Action = {
  name: 'break_down',
  description: 'Use when the worker needs to split vague or high-level work into smaller concrete steps.',
  parameters: [
    { name: 'focus', description: 'Short description of the work being broken down', required: false }
  ],
  examples: [
    '{"action": {"type": "break_down", "focus": "authentication refactor"}}',
    '{"action": {"type": "break_down"}}'
  ]
}

export const ideate: Action = {
  name: 'ideate',
  description: 'Use when the worker should look for useful work because nothing concrete is queued yet.',
  parameters: [
    { name: 'text', description: 'Optional additional guidance for how to ideate', required: false }
  ],
  examples: [
    '{"action": {"type": "ideate"}}',
    '{"action": {"type": "ideate", "text": "scan the codebase for the next concrete improvement"}}'
  ]
}

export const textPrompt: Action = {
  name: 'text_prompt',
  description: 'Prompt the worker to keep advancing the work.',
  parameters: [
    { name: 'text', description: 'Text to send to the worker. If omitted, a default keep-working prompt is used.', required: false }
  ],
  examples: [
    '{"action": {"type": "text_prompt"}}',
    '{"action": {"type": "text_prompt", "text": "keep advancing and surface blockers explicitly"}}'
  ]
}

export const verify: Action = {
  name: 'verify',
  description: 'Use when the worker reports being done or looks ready for a verification pass.',
  parameters: [
    { name: 'text', description: 'Optional extra verification guidance to append to the default verification prompt', required: false }
  ],
  examples: [
    '{"action": {"type": "verify"}}',
    '{"action": {"type": "verify", "text": "double-check the acceptance criteria against the current output"}}'
  ]
}

export const choice: Action = {
  name: 'choice',
  description: 'Choose one of the currently visible options in the worker terminal. If the agent prompts for a choice, you have to take this choice action. Example context: "› 1. Allow ... 2. Allow for this session ... 3. Always allow ... 4. Cancel ... enter to submit | esc to cancel".',
  parameters: [
    { name: 'choice', description: 'Visible option to select, usually a number or shortcut key', required: true }
  ],
  examples: [
    '{"action": {"type": "choice", "choice": "1"}}',
    '{"action": {"type": "choice", "choice": "2"}}',
    '{"action": {"type": "choice", "choice": "esc"}}'
  ]
}

export const revisit: Action = {
  name: 'revisit',
  description: 'Return from wrapping up to implementation because more work is still needed.',
  parameters: [
    { name: 'text', description: 'Optional extra message to send with the revisit prompt', required: false }
  ],
  examples: [
    '{"action": {"type": "revisit"}}',
    '{"action": {"type": "revisit", "text": "finish implementation of the missing edge case handling"}}'
  ]
}

export const wrapUp: Action = {
  name: 'wrap_up',
  description: 'Prompt the worker to update aim status/comment and reflection if not done already.',
  parameters: [
    { name: 'text', description: 'Optional extra wrap-up guidance', required: false }
  ],
  examples: [
    '{"action": {"type": "wrap_up"}}',
    '{"action": {"type": "wrap_up", "text": "make sure the status comment reflects what was actually completed"}}'
  ]
}

export const commit: Action = {
  name: 'commit',
  description: 'Prompt the worker to create a git commit for the current batch of work.',
  parameters: [
    { name: 'text', description: 'Optional extra commit guidance', required: false }
  ],
  examples: [
    '{"action": {"type": "commit"}}',
    '{"action": {"type": "commit", "text": "include only the intentional changes in the commit"}}'
  ]
}

export const waitingForCommitted: Action = {
  name: 'waiting_for_committed',
  description: 'Use when the worker is in the middle of committing and should simply be left to finish that step.',
  parameters: [
    { name: 'reason', description: 'Optional reason for waiting', required: false }
  ],
  examples: [
    '{"action": {"type": "waiting_for_committed"}}'
  ]
}

export const explore: Action = {
  name: 'explore',
  description: 'Prompt the worker to explore open work again and return to the exploring phase.',
  parameters: [
    { name: 'text', description: 'Optional extra exploration guidance', required: false }
  ],
  examples: [
    '{"action": {"type": "explore"}}',
    '{"action": {"type": "explore", "text": "look for the next concrete task that can be started now"}}'
  ]
}

// ========== STATE DEFINITIONS ==========

export const exploring: State = {
  name: 'EXPLORING',
  instructions: 'You are watching a coding agent that is exploring for the next task. If the worker has found something concrete, use start_work. Otherwise use break_down or ideate to keep discovery moving.',
  color: '#a8dadc',  // Pastel cyan - exploring, discovering
  actions: [
    { action: startWork, targetState: 'WORKING' },
    { action: breakDown, targetState: 'EXPLORING' },
    { action: ideate, targetState: 'EXPLORING' },
    { action: choice, targetState: 'EXPLORING' }
  ]
}

export const working: State = {
  name: 'WORKING',
  instructions: 'You are watching a coding agent at work. Prompt him to keep advancing. If offered choices, chose one that advances the work. If the worker reports to be done, switch into wrapping up mode.',
  color: '#a8e6a3',  // Pastel green - active work
  actions: [
    { action: textPrompt, targetState: 'WORKING' },
    { action: choice, targetState: 'WORKING' },
    { action: verify, targetState: 'WRAPPING_UP' }
  ]
}

export const wrappingUp: State = {
  name: 'WRAPPING_UP',
  instructions: 'You are watching a coding agent wrapping up work. If more implementation is needed, use revisit. Otherwise guide the worker through aim updates/reflection, then commit, then return to exploring.',
  color: '#ffe5a3',  // Pastel yellow - completion phase
  actions: [
    { action: choice, targetState: 'WRAPPING_UP' },
    { action: revisit, targetState: 'WORKING' },
    { action: wrapUp, targetState: 'WRAPPING_UP' },
    { action: commit, targetState: 'WRAPPING_UP' },
    { action: waitingForCommitted, targetState: 'WRAPPING_UP' },
    { action: explore, targetState: 'EXPLORING' }
  ]
}

// ========== STATE MACHINE ==========

export const STATE_MACHINE: Record<string, State> = {
  EXPLORING: exploring,
  WORKING: working,
  WRAPPING_UP: wrappingUp
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
