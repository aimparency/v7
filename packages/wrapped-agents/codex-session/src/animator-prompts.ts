/**
 * Animator State Machine Prompts
 *
 * Generates focused prompts dynamically from state machine definition.
 */

import type { AnimatorStateName, StateContext } from './animator-state'
import { getStateDefinition, getValidActionNames, isValidActionForState, STATE_MACHINE } from './state-machine-definition'

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
 * Generate supervisor prompt for current state (using state machine definition)
 */
export function generateSupervisorPrompt(promptContext: PromptContext, requestId: string): string {
  const marker = `${PROMPT_MARKER} [${requestId}]`
  const stateDefinition = getStateDefinition(promptContext.state)

  if (!stateDefinition) {
    throw new Error(`Unknown state: ${promptContext.state}`)
  }

  // Build context section based on state
  let contextSection = buildContextSection(promptContext)

  // Build actions section from state definition
  let actionsSection = buildActionsSection(stateDefinition)

  // Combine into final prompt
  return `[STATE: ${stateDefinition.name}]

${stateDefinition.description}

${contextSection}

Available actions:

${actionsSection}

${marker}`
}

/**
 * Build context section based on state and available data
 */
function buildContextSection(ctx: PromptContext): string {
  let lines: string[] = []

  // Supervised session context (always shown)
  lines.push('Supervised session context:')
  lines.push(ctx.supervisedContext)
  lines.push('')

  // State-specific context
  if (ctx.state === 'EXPLORING') {
    lines.push('Current project status:')
    lines.push(`- Active phases: ${ctx.activePhases?.join(', ') || 'unknown'}`)
    lines.push(`- Open aims: ${ctx.openAimsCount ?? 'unknown'}`)
    lines.push(`- Compute budget: ${ctx.computeCredits ?? 'unknown'} credits`)
  } else if (ctx.state === 'WORKING') {
    lines.push(`Currently working on: ${ctx.aimText || 'unknown'}`)
    lines.push(`Time elapsed: ${ctx.workDuration || 'unknown'}`)
    lines.push(`Supervised session status: ${ctx.supervisedStatus || 'unknown'}`)
  } else if (ctx.state === 'WRAPPING_UP') {
    lines.push(`Completed aim: ${ctx.aimText || 'unknown'}`)
    if (ctx.workSummary) {
      lines.push(`Work summary: ${ctx.workSummary}`)
    }
    lines.push('')
    lines.push('Question: Has ~80% of the aim requirements been met?')
    lines.push('(Good enough, not perfect - avoid overengineering)')
  } else if (ctx.state === 'ERROR') {
    lines.push(`Error count: ${ctx.metadata?.errorCount ?? 1}`)
    lines.push(`Last error: ${ctx.metadata?.lastError ?? 'unknown'}`)
    lines.push(`Previous state: ${ctx.metadata?.previousState ?? 'unknown'}`)
  }

  return lines.join('\n')
}

/**
 * Build actions section from state definition
 */
function buildActionsSection(stateDefinition: any): string {
  return stateDefinition.actions.map((action: any, index: number) => {
    let section = `${index + 1}. ${action.name} - ${action.description}\n`

    // Show parameters
    if (action.parameters.length > 0) {
      section += '   Parameters:\n'
      action.parameters.forEach((param: any) => {
        const required = param.required ? 'required' : 'optional'
        section += `   - ${param.name} (${required}): ${param.description}\n`
      })
    }

    // Show examples
    if (action.examples.length > 0) {
      section += '   Examples:\n'
      action.examples.forEach((example: string) => {
        section += `   ${example}\n`
      })
    }

    return section
  }).join('\n')
}

/**
 * Extract valid action types for current state (from state machine definition)
 */
export function getValidActionsForState(state: AnimatorStateName): string[] {
  return getValidActionNames(state)
}

/**
 * Validate if action is allowed in current state (from state machine definition)
 */
export function isValidAction(state: AnimatorStateName, actionType: string): boolean {
  return isValidActionForState(state, actionType)
}
