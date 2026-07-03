/**
 * Supervisor State Machine Prompts
 *
 * Generates prompts dynamically from state machine definition.
 */

import type { SupervisorStateName, StateContext, AutonomyPolicy } from './supervisor-state'
import { getState, type State, type Action } from './state-machine-definition'

const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks)."

export interface PromptContext {
  state: SupervisorStateName
  supervisedContext: string  // Last N lines from worker session
  aimText?: string
  workDuration?: string
  supervisedStatus?: string
  workSummary?: string
  requiresInput?: boolean
  autonomyPolicy?: AutonomyPolicy
}

/**
 * Generate watchdog prompt for current state
 *
 * Format:
 * - You are supervising a coding assistant. The current situation is this: <current situation>.
 * - <state specific instruction>
 * - answer with json and some of the available action types: <list of actions>
 * - for example: <examples>
 */
export function generateSupervisorPrompt(promptContext: PromptContext, requestId: string): string {
  const shortMarker = `<<SUPERVISOR_JSON:${requestId}>>`
  const state = getState(promptContext.state)

  if (!state) {
    throw new Error(`Unknown state: ${promptContext.state}`)
  }

  // Build current situation
  const situation = buildSituation(promptContext)

  // State-specific instructions
  let instructions = state.instructions

  // Apply autonomy policy overrides
  if (promptContext.autonomyPolicy) {
    if (promptContext.state === 'WRAPPING_UP') {
      if (promptContext.autonomyPolicy.requireCommitBeforeCompact === false) {
        instructions += '\n\nPOLICY: Git commits are OPTIONAL before returning to exploring. You may proceed to explore even if no commit was made if you believe the work is complete or the changes are trivial.'
      } else {
        instructions += '\n\nPOLICY: A git commit is MANDATORY before you allow the worker to return to exploring. Ensure all work is tracked.'
      }
    }
  }

  // List of actions
  const actionsList = buildActionsList(state)

  // Examples
  const examples = buildExamples(state)

  return `You are guiding a worker. the current situation is this:

${situation}

${instructions}

answer with json using one of the available action types:

${actionsList}

for example:
${examples}

Respond ONLY with a single line that starts with the exact token ${shortMarker} immediately followed by the raw minified JSON object (no markdown, no code fences, no extra text). Example: ${shortMarker}{"action":{"type":"start_work", ...}}
`
}

/**
 * Build current situation description
 */
function buildSituation(ctx: PromptContext): string {
  let lines: string[] = []

  // Always show supervised session context
  lines.push('worker session:')
  lines.push(ctx.supervisedContext)
  lines.push('')

  if (ctx.supervisedStatus) {
    lines.push(`worker status: ${ctx.supervisedStatus}`)
  }
  if (ctx.requiresInput !== undefined) {
    lines.push(`worker requires input: ${ctx.requiresInput ? 'yes' : 'no'}`)
  }
  lines.push('rule: current terminal/repo-facing evidence is more reliable than prior narrative claims')

  // State-specific situation details
  if (ctx.state === 'WORKING') {
    if (ctx.aimText) {
      lines.push(`current focus: ${ctx.aimText}`)
    }
    if (ctx.workDuration) {
      lines.push(`time elapsed: ${ctx.workDuration}`)
    }
  } else if (ctx.state === 'WRAPPING_UP') {
    if (ctx.aimText) {
      lines.push(`current focus: ${ctx.aimText}`)
    }
    if (ctx.workSummary) {
      lines.push(`summary: ${ctx.workSummary}`)
    }
    lines.push('')
    lines.push('question: should the worker go back to implementation, finish wrap-up tasks, or move on to exploring?')
  } else if (ctx.state === 'ERROR') {
    lines.push('')
    lines.push('SYSTEM ALERT: The system is in a recovery backoff period following a timeout or failure.')
    lines.push('The backoff duration increases exponentially with each consecutive error.')
    lines.push('You should analyze the terminal output to understand what went wrong, and when you believe the worker is ready or the environment is stable, use the "retry" action to return to the previous state.')
  }

  return lines.join('\n')
}

/**
 * Build list of available actions with descriptions and parameters
 */
function buildActionsList(state: State): string {
  return state.actions.map((sa, index) => {
    const action = sa.action
    let text = `${index + 1}. ${action.name} - ${action.description}`

    if (action.parameters.length > 0) {
      text += '\n   Parameters:'
      action.parameters.forEach(param => {
        const req = param.required ? 'required' : 'optional'
        text += `\n   - ${param.name} (${req}): ${param.description}`
      })
    }

    return text
  }).join('\n\n')
}

/**
 * Build examples from all actions in state
 */
function buildExamples(state: State): string {
  const allExamples: string[] = []

  state.actions.forEach(sa => {
    // Take first example from each action (max 3 total)
    if (sa.action.examples.length > 0 && allExamples.length < 3) {
      allExamples.push(sa.action.examples[0])
    }
  })

  return allExamples.join('\n')
}

/**
 * Extract valid action types for current state
 */
export function getValidActionsForState(state: SupervisorStateName): string[] {
  const stateObj = getState(state)
  return stateObj?.actions.map(sa => sa.action.name) || []
}

/**
 * Validate if action is allowed in current state
 */
export function isValidAction(state: SupervisorStateName, actionType: string): boolean {
  return getValidActionsForState(state).includes(actionType)
}

/**
 * Centralized generation of worker prompts for state machine side-effects.
 * These are the text prompts posted to the worker session.
 */
export const ActionPrompts = {
  startWork: (message: string) => `Check Aimparency MCP for open aims or the current assigned aim. Before making changes, investigate the codebase to see if the aim is already implemented, partially implemented, or cancelled. Update the aim status accordingly if needed. Otherwise, start working. ${message}`,
  
  breakDown: (message?: string) => {
    const defaultPrompt = 'Check Aimparency MCP for the current open aim, break it down into smaller concrete sub-aims or tasks, then continue with the next best step.';
    return message ? `${defaultPrompt} ${message}` : defaultPrompt;
  },
  
  ideate: (text?: string) => {
    const defaultPrompt = 'Check Aimparency MCP for open aims and look for the next concrete task to start.';
    return text ? `${defaultPrompt} ${text}` : defaultPrompt;
  },
  
  textPrompt: (text?: string) => text || 'Keep advancing the work.',
  
  verify: (text?: string) => {
    const defaultPrompt = 'verify that more than 80% of the tackled requirements have been met. If the work is good enough, prepare to update the aim via Aimparency MCP.';
    return text ? `${defaultPrompt} ${text}` : defaultPrompt;
  },
  
  revisit: (text?: string) => text ? `finish implementation. ${text}` : 'finish implementation',
  
  wrapUp: (text?: string) => {
    const defaultPrompt = 'use Aimparency MCP to update aim status and comment and reflection if not done already';
    return text ? `${defaultPrompt}. ${text}` : defaultPrompt;
  },
  
  commit: (text?: string) => {
    const COMMIT_GRAPH_STATUS_HINT = 'When code and aim status both changed, it is elegant to commit them together, including the relevant .bowman files.';
    const WRAP_UP_PROMPT = `Before compressing, make a git commit for the work completed so far. Review git status, stage the intended files, create the commit, and then wait for compaction. ${COMMIT_GRAPH_STATUS_HINT} If you need short guidance for the commit, ask explicitly.`;
    return text ? `Track changes and make a git commit for the completed work. ${COMMIT_GRAPH_STATUS_HINT} ${text}` : WRAP_UP_PROMPT;
  },
  
  explore: (text?: string) => text || 'check Aimparency MCP for open aims and see if there is something you can work on'
};
