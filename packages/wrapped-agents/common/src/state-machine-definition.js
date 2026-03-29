"use strict";
/**
 * Declarative State Machine Definition
 *
 * Actions are defined as const objects, states reference them with target states.
 * Prompts are generated dynamically from this definition.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATE_MACHINE = exports.errorState = exports.wrappingUp = exports.working = exports.exploring = exports.abort = exports.reset = exports.retry = exports.verifyIncomplete = exports.verifyComplete = exports.wrapUp = exports.proceed = exports.wait = exports.ideate = exports.breakDown = exports.startWork = void 0;
exports.getState = getState;
exports.getValidActionNames = getValidActionNames;
exports.isValidActionForState = isValidActionForState;
exports.getTargetState = getTargetState;
// ========== ACTION DEFINITIONS ==========
exports.startWork = {
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
};
exports.breakDown = {
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
};
exports.ideate = {
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
};
exports.wait = {
    name: 'wait',
    description: 'Do nothing right now. Use when there is truly no work available and ideation is not appropriate.',
    parameters: [
        { name: 'reason', description: 'Why waiting (e.g., "no open aims", "all aims blocked")', required: true }
    ],
    examples: [
        '{"action": {"type": "wait", "reason": "no open aims available"}}',
        '{"action": {"type": "wait", "reason": "all aims are blocked by dependencies"}}'
    ]
};
exports.proceed = {
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
};
exports.wrapUp = {
    name: 'wrap_up',
    description: 'Work appears complete. Transition to verification. Use when the aim implementation looks done.',
    parameters: [
        { name: 'summary', description: 'Brief summary of what was accomplished', required: true }
    ],
    examples: [
        '{"action": {"type": "wrap_up", "summary": "Implemented login form with validation and error handling"}}',
        '{"action": {"type": "wrap_up", "summary": "Added unit tests, all passing"}}'
    ]
};
exports.verifyComplete = {
    name: 'verify_complete',
    description: 'Work meets ~80% of requirements (good enough, not perfect). Triggers: verify → commit → reflect → compact → explore.',
    parameters: [
        { name: 'notes', description: 'What looks good about the implementation', required: true }
    ],
    examples: [
        '{"action": {"type": "verify_complete", "notes": "Core functionality works, tests passing, good enough"}}',
        '{"action": {"type": "verify_complete", "notes": "Feature complete as requested, basic validation in place"}}'
    ]
};
exports.verifyIncomplete = {
    name: 'verify_incomplete',
    description: 'Work does not meet ~80% threshold. Return to WORKING state with guidance.',
    parameters: [
        { name: 'missing', description: 'What is not complete yet', required: true }
    ],
    examples: [
        '{"action": {"type": "verify_incomplete", "missing": "Tests are failing, need to fix validation logic"}}',
        '{"action": {"type": "verify_incomplete", "missing": "Feature works but missing error handling"}}'
    ]
};
exports.retry = {
    name: 'retry',
    description: 'Try to continue from previous state. Use when the worker looks responsive again.',
    parameters: [
        { name: 'reason', description: 'Why retrying is appropriate', required: true }
    ],
    examples: [
        '{"action": {"type": "retry", "reason": "Worker is responding now"}}',
        '{"action": {"type": "retry", "reason": "Timeout was temporary"}}'
    ]
};
exports.reset = {
    name: 'reset',
    description: 'Give up on current work, return to EXPLORING. Use when work is stuck.',
    parameters: [
        { name: 'reason', description: 'Why resetting is necessary', required: true }
    ],
    examples: [
        '{"action": {"type": "reset", "reason": "Worker is stuck, start over"}}',
        '{"action": {"type": "reset", "reason": "Too many errors"}}'
    ]
};
exports.abort = {
    name: 'abort',
    description: 'Abort and return to EXPLORING. For unrecoverable errors.',
    parameters: [
        { name: 'reason', description: 'Why aborting', required: true }
    ],
    examples: [
        '{"action": {"type": "abort", "reason": "Unrecoverable error"}}',
        '{"action": {"type": "abort", "reason": "Critical failure"}}'
    ]
};
// ========== STATE DEFINITIONS ==========
exports.exploring = {
    name: 'EXPLORING',
    instructions: 'Take a look at the open aims and see if there is something you can work on. If not, choose a high level aim to break down, or come up with new hypotheses and ideas - maybe browse the web for inspiration.',
    actions: [
        { action: exports.startWork, targetState: 'WORKING' },
        { action: exports.breakDown, targetState: 'EXPLORING' },
        { action: exports.ideate, targetState: 'EXPLORING' },
        { action: exports.wait, targetState: 'EXPLORING' }
    ]
};
exports.working = {
    name: 'WORKING',
    instructions: 'Actively working on an aim. Monitor progress and help the worker complete the task. When the work looks complete, use wrap_up to begin verification.',
    actions: [
        { action: exports.proceed, targetState: 'WORKING' },
        { action: exports.wrapUp, targetState: 'WRAPPING_UP' }
    ]
};
exports.wrappingUp = {
    name: 'WRAPPING_UP',
    instructions: 'Verify work completion using ~80% threshold (good enough, not perfect). If complete, will trigger commit → reflect → compact → explore. If incomplete, return to working.',
    actions: [
        { action: exports.verifyComplete, targetState: 'EXPLORING' },
        { action: exports.verifyIncomplete, targetState: 'WORKING' }
    ]
};
exports.errorState = {
    name: 'ERROR',
    instructions: 'Error occurred (timeout, parse failure, etc.). Exponential backoff active. Decide whether to retry, reset, or abort.',
    actions: [
        { action: exports.retry, targetState: 'PREVIOUS' }, // Special: returns to previous state
        { action: exports.reset, targetState: 'EXPLORING' },
        { action: exports.abort, targetState: 'EXPLORING' }
    ]
};
// ========== STATE MACHINE ==========
exports.STATE_MACHINE = {
    EXPLORING: exports.exploring,
    WORKING: exports.working,
    WRAPPING_UP: exports.wrappingUp,
    ERROR: exports.errorState
};
// ========== HELPER FUNCTIONS ==========
function getState(stateName) {
    return exports.STATE_MACHINE[stateName];
}
function getValidActionNames(stateName) {
    const state = getState(stateName);
    return state?.actions.map(sa => sa.action.name) || [];
}
function isValidActionForState(stateName, actionName) {
    return getValidActionNames(stateName).includes(actionName);
}
function getTargetState(stateName, actionName) {
    const state = getState(stateName);
    const stateAction = state?.actions.find(sa => sa.action.name === actionName);
    return stateAction?.targetState;
}
