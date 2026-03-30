/**
 * Animator State Machine Prompts
 *
 * Generates prompts dynamically from state machine definition.
 */

import type { AnimatorStateName, StateContext } from './animator-state'
import { getState, type State, type Action } from './state-machine-definition'

const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks)."

export interface PromptContext {
  state: AnimatorStateName
  supervisedContext: string  // Last N lines from supervised session
  activePhases?: string[]
  openAimsCount?: number
  computeCredits?: number
  aimText?: string
  workDuration?: string
  supervisedStatus?: string
  workSummary?: string
  metadata?: Record<string, any>
}

/**
 * Generate supervisor prompt for current state
 *
 * Format:
 * - You are supervising a coding assistant. The current situation is this: <current situation>.
 * - <state specific instruction>
 * - answer with json and some of the available action types: <list of actions>
 * - for example: <examples>
 */
export function generateSupervisorPrompt(promptContext: PromptContext, requestId: string): string {
  const marker = `${PROMPT_MARKER} [${requestId}]`
  const state = getState(promptContext.state)

  if (!state) {
    throw new Error(`Unknown state: ${promptContext.state}`)
  }

  // Build current situation
  const situation = buildSituation(promptContext)

  // State-specific instructions
  const instructions = state.instructions

  // List of actions
  const actionsList = buildActionsList(state)

  // Examples
  const examples = buildExamples(state)

  return `You are supervising a coding assistant. The current situation is this:

${situation}

${instructions}

Answer with json using one of the available action types:

${actionsList}

For example:
${examples}

${marker}`
}

/**
 * Build current situation description
 */
function buildSituation(ctx: PromptContext): string {
  let lines: string[] = []

  // Always show supervised session context
  lines.push('Supervised session:')
  lines.push(ctx.supervisedContext)
  lines.push('')

  // State-specific situation details
  if (ctx.state === 'EXPLORING') {
    if (ctx.activePhases && ctx.activePhases.length > 0) {
      lines.push(`Active phases: ${ctx.activePhases.join(', ')}`)
    }
    if (ctx.openAimsCount !== undefined) {
      lines.push(`Open aims: ${ctx.openAimsCount}`)
    }
    if (ctx.computeCredits !== undefined) {
      lines.push(`Compute budget: ${ctx.computeCredits} credits`)
    }
  } else if (ctx.state === 'WORKING') {
    if (ctx.aimText) {
      lines.push(`Currently working on: ${ctx.aimText}`)
    }
    if (ctx.workDuration) {
      lines.push(`Time elapsed: ${ctx.workDuration}`)
    }
  } else if (ctx.state === 'WRAPPING_UP') {
    if (ctx.aimText) {
      lines.push(`Completed aim: ${ctx.aimText}`)
    }
    if (ctx.workSummary) {
      lines.push(`Summary: ${ctx.workSummary}`)
    }
    lines.push('')
    lines.push('Question: Has ~80% of the aim requirements been met? (Good enough, not perfect)')
  } else if (ctx.state === 'ERROR') {
    lines.push(`Error count: ${ctx.metadata?.errorCount ?? 1}`)
    lines.push(`Last error: ${ctx.metadata?.lastError ?? 'unknown'}`)
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
export function getValidActionsForState(state: AnimatorStateName): string[] {
  const stateObj = getState(state)
  return stateObj?.actions.map(sa => sa.action.name) || []
}

/**
 * Validate if action is allowed in current state
 */
export function isValidAction(state: AnimatorStateName, actionType: string): boolean {
  return getValidActionsForState(state).includes(actionType)
}
