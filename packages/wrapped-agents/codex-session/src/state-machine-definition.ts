/**
 * Declarative State Machine Definition
 *
 * Single source of truth for all states, actions, parameters, and examples.
 * Prompts are generated dynamically from this definition.
 */

export interface ActionParameter {
  name: string
  description: string
  required: boolean
  type?: 'string' | 'number' | 'boolean'
}

export interface ActionDefinition {
  name: string
  description: string  // When to use this action
  parameters: ActionParameter[]
  examples: string[]  // JSON examples (up to 3)
}

export interface StateDefinition {
  name: string
  description: string  // What this state is for
  actions: ActionDefinition[]
}

// ========== STATE MACHINE DEFINITION ==========

export const STATE_MACHINE: StateDefinition[] = [
  // ========== EXPLORING STATE ==========
  {
    name: 'EXPLORING',
    description: 'Looking for work to do. Check aims, create new aims, break down complex aims.',
    actions: [
      {
        name: 'start_work',
        description: 'Begin working on a specific aim. Use when you find an open aim that needs implementation.',
        parameters: [
          { name: 'aim_id', description: 'UUID of the aim to work on', required: true },
          { name: 'aim_text', description: 'Text description of the aim', required: true },
          { name: 'strategy', description: 'Approach to take for implementing this aim', required: true }
        ],
        examples: [
          '{"action": {"type": "start_work", "aim_id": "abc-123", "aim_text": "Add unit tests for auth module", "strategy": "Write Jest tests covering login, logout, and token refresh"}}',
          '{"action": {"type": "start_work", "aim_id": "def-456", "aim_text": "Implement dark mode toggle", "strategy": "Add CSS variables for theming and toggle component"}}',
          '{"action": {"type": "start_work", "aim_id": "ghi-789", "aim_text": "Fix memory leak in dashboard", "strategy": "Add cleanup in useEffect hooks for event listeners"}}'
        ]
      },
      {
        name: 'break_down',
        description: 'Decompose a complex aim into smaller sub-aims. Use when an aim is too large to implement directly.',
        parameters: [
          { name: 'aim_id', description: 'UUID of the aim to break down into sub-aims', required: true }
        ],
        examples: [
          '{"action": {"type": "break_down", "aim_id": "abc-123"}}',
          '{"action": {"type": "break_down", "aim_id": "complex-feature-xyz"}}'
        ]
      },
      {
        name: 'ideate',
        description: 'Generate new aims through research, codebase review, or improvements. Use when no obvious work exists.',
        parameters: [
          { name: 'ideation_type', description: 'Type of ideation: "research" (web research), "new_aims" (scan codebase for improvements), "improvements" (review recent work)', required: true }
        ],
        examples: [
          '{"action": {"type": "ideate", "ideation_type": "research"}}',
          '{"action": {"type": "ideate", "ideation_type": "new_aims"}}',
          '{"action": {"type": "ideate", "ideation_type": "improvements"}}'
        ]
      },
      {
        name: 'wait',
        description: 'Do nothing right now. Use when there is truly no work available and ideation is not needed.',
        parameters: [
          { name: 'reason', description: 'Why waiting (e.g., "no open aims", "all aims blocked")', required: true }
        ],
        examples: [
          '{"action": {"type": "wait", "reason": "no open aims available"}}',
          '{"action": {"type": "wait", "reason": "all aims are blocked by dependencies"}}'
        ]
      }
    ]
  },

  // ========== WORKING STATE ==========
  {
    name: 'WORKING',
    description: 'Actively working on an aim. Monitor progress and help the worker complete the task.',
    actions: [
      {
        name: 'proceed',
        description: 'Continue working. Choose proceed_type based on what the worker needs.',
        parameters: [
          { name: 'proceed_type', description: '"none" (just monitor), "motivate" (send encouraging text), "option_select" (choose from menu), "escalate" (ask human)', required: true },
          { name: 'text', description: 'Text to send (only for proceed_type=motivate)', required: false },
          { name: 'choice', description: 'Option to select: number or letter (only for proceed_type=option_select)', required: false },
          { name: 'question', description: 'Question for human (only for proceed_type=escalate)', required: false }
        ],
        examples: [
          '{"action": {"type": "proceed", "proceed_type": "none"}}',
          '{"action": {"type": "proceed", "proceed_type": "motivate", "text": "Keep going, you\'re making good progress!"}}',
          '{"action": {"type": "proceed", "proceed_type": "option_select", "choice": "1"}}',
          '{"action": {"type": "proceed", "proceed_type": "option_select", "choice": "y"}}',
          '{"action": {"type": "proceed", "proceed_type": "escalate", "question": "Should we use PostgreSQL or MongoDB for this feature?"}}'
        ]
      },
      {
        name: 'wrap_up',
        description: 'Work appears complete. Transition to verification. Use when the aim implementation looks done.',
        parameters: [
          { name: 'summary', description: 'Brief summary of what was accomplished', required: true }
        ],
        examples: [
          '{"action": {"type": "wrap_up", "summary": "Implemented login form with validation and error handling"}}',
          '{"action": {"type": "wrap_up", "summary": "Added 15 unit tests covering all auth functions, all passing"}}',
          '{"action": {"type": "wrap_up", "summary": "Refactored API client to use async/await, updated all call sites"}}'
        ]
      }
    ]
  },

  // ========== WRAPPING_UP STATE ==========
  {
    name: 'WRAPPING_UP',
    description: 'Verify work completion (~80% threshold), commit changes, add reflection, compact.',
    actions: [
      {
        name: 'verify_complete',
        description: 'Work meets ~80% of requirements (good enough, not perfect). This will trigger: verify → commit → reflect → compact → return to EXPLORING.',
        parameters: [
          { name: 'notes', description: 'What looks good about the implementation', required: true }
        ],
        examples: [
          '{"action": {"type": "verify_complete", "notes": "Core functionality works, tests passing, good enough for now"}}',
          '{"action": {"type": "verify_complete", "notes": "Feature implemented as requested, basic error handling in place"}}',
          '{"action": {"type": "verify_complete", "notes": "Refactoring complete, code cleaner and more maintainable"}}'
        ]
      },
      {
        name: 'verify_incomplete',
        description: 'Work does not meet ~80% threshold. Return to WORKING state with guidance on what\'s missing.',
        parameters: [
          { name: 'missing', description: 'What is not complete yet and needs to be addressed', required: true }
        ],
        examples: [
          '{"action": {"type": "verify_incomplete", "missing": "Tests are failing, need to fix validation logic"}}',
          '{"action": {"type": "verify_incomplete", "missing": "Feature works but has no error handling for edge cases"}}',
          '{"action": {"type": "verify_incomplete", "missing": "Code written but not integrated with existing UI components"}}'
        ]
      }
    ]
  },

  // ========== ERROR STATE ==========
  {
    name: 'ERROR',
    description: 'Error occurred (timeout, parse failure, etc.). Exponential backoff active.',
    actions: [
      {
        name: 'retry',
        description: 'Try to continue from previous state. Use when the worker looks responsive again.',
        parameters: [
          { name: 'reason', description: 'Why retrying is appropriate', required: true }
        ],
        examples: [
          '{"action": {"type": "retry", "reason": "Worker is responding now, let\'s continue"}}',
          '{"action": {"type": "retry", "reason": "Timeout was temporary, session looks healthy"}}'
        ]
      },
      {
        name: 'reset',
        description: 'Give up on current work, return to EXPLORING to start fresh. Use when work is stuck.',
        parameters: [
          { name: 'reason', description: 'Why resetting is necessary', required: true }
        ],
        examples: [
          '{"action": {"type": "reset", "reason": "Worker is stuck, better to start over"}}',
          '{"action": {"type": "reset", "reason": "Too many errors, let\'s find different work"}}'
        ]
      },
      {
        name: 'abort',
        description: 'Abort and return to EXPLORING. Similar to reset but implies unrecoverable error.',
        parameters: [
          { name: 'reason', description: 'Why aborting', required: true }
        ],
        examples: [
          '{"action": {"type": "abort", "reason": "Unrecoverable error in worker session"}}',
          '{"action": {"type": "abort", "reason": "Critical failure, cannot continue"}}'
        ]
      }
    ]
  }
]

// ========== HELPER FUNCTIONS ==========

/**
 * Get state definition by name
 */
export function getStateDefinition(stateName: string): StateDefinition | undefined {
  return STATE_MACHINE.find(s => s.name === stateName)
}

/**
 * Get action definition by name within a state
 */
export function getActionDefinition(stateName: string, actionName: string): ActionDefinition | undefined {
  const state = getStateDefinition(stateName)
  return state?.actions.find(a => a.name === actionName)
}

/**
 * Get all valid action names for a state
 */
export function getValidActionNames(stateName: string): string[] {
  const state = getStateDefinition(stateName)
  return state?.actions.map(a => a.name) || []
}

/**
 * Check if action is valid for state
 */
export function isValidActionForState(stateName: string, actionName: string): boolean {
  return getValidActionNames(stateName).includes(actionName)
}
