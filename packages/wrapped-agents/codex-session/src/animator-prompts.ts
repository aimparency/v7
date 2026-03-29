/**
 * Animator State Machine Prompts
 *
 * Generates focused prompts for each state, showing only relevant actions.
 */

import type { AnimatorStateName, StateContext } from './animator-state'

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
 */
export function generateSupervisorPrompt(promptContext: PromptContext, requestId: string): string {
  const marker = `${PROMPT_MARKER} [${requestId}]`

  switch (promptContext.state) {
    case 'EXPLORING':
      return generateExploringPrompt(promptContext, marker)
    case 'WORKING':
      return generateWorkingPrompt(promptContext, marker)
    case 'WRAPPING_UP':
      return generateWrappingUpPrompt(promptContext, marker)
    case 'ERROR':
      return generateErrorPrompt(promptContext, marker)
    default:
      throw new Error(`Unknown state: ${promptContext.state}`)
  }
}

/**
 * EXPLORING state prompt
 */
function generateExploringPrompt(ctx: PromptContext, marker: string): string {
  return `[STATE: EXPLORING]

You are supervising an autonomous coding session. Look at the supervised session and decide what to work on next.

Supervised session context:
${ctx.supervisedContext}

Current project status:
- Active phases: ${ctx.activePhases?.join(', ') || 'unknown'}
- Open aims: ${ctx.openAimsCount ?? 'unknown'}
- Compute budget: ${ctx.computeCredits ?? 'unknown'} credits

Available actions (respond with ONE as JSON):

1. start_work - Begin working on a specific aim
   {"action": {"type": "start_work", "aim_id": "uuid", "aim_text": "description", "strategy": "approach to take"}}

2. break_down - Decompose a complex aim into sub-aims
   {"action": {"type": "break_down", "aim_id": "uuid"}}

3. ideate - Generate new aims, research, or improvements
   {"action": {"type": "ideate", "ideation_type": "research"}}  ← research a topic
   {"action": {"type": "ideate", "ideation_type": "new_aims"}}  ← create improvement aims
   {"action": {"type": "ideate", "ideation_type": "improvements"}}  ← review and suggest optimizations

4. wait - Nothing to do right now
   {"action": {"type": "wait", "reason": "no open aims available"}}

${marker}`
}

/**
 * WORKING state prompt
 */
function generateWorkingPrompt(ctx: PromptContext, marker: string): string {
  return `[STATE: WORKING]

Currently working on: ${ctx.aimText || 'unknown'}
Time elapsed: ${ctx.workDuration || 'unknown'}
Supervised session status: ${ctx.supervisedStatus || 'unknown'}

Supervised session context:
${ctx.supervisedContext}

Available actions (respond with ONE as JSON):

1. proceed - Continue working (choose type based on situation)
   {"action": {"type": "proceed", "proceed_type": "none"}}  ← Just monitor, don't interrupt
   {"action": {"type": "proceed", "proceed_type": "motivate", "text": "keep going!"}}  ← Send encouraging prompt
   {"action": {"type": "proceed", "proceed_type": "option_select", "choice": "1"}}  ← Choose numbered option
   {"action": {"type": "proceed", "proceed_type": "option_select", "choice": "y"}}  ← Choose keyboard shortcut
   {"action": {"type": "proceed", "proceed_type": "escalate", "question": "..."}}  ← Ask human for critical decision

2. wrap_up - Work appears complete, ready to verify and commit
   {"action": {"type": "wrap_up", "summary": "what was accomplished"}}

Guidelines:
- Use proceed with "none" when supervised session is actively working
- Use proceed with "motivate" only when supervised session is idle but work not complete
- Use proceed with "option_select" when you see visible choices like (A) (B) (C) or (y/n)
- Use wrap_up when work appears complete and ready for verification
- Use escalate for critical decisions that need human judgment

${marker}`
}

/**
 * WRAPPING_UP state prompt
 */
function generateWrappingUpPrompt(ctx: PromptContext, marker: string): string {
  return `[STATE: WRAPPING_UP]

Completed aim: ${ctx.aimText || 'unknown'}
Work summary: ${ctx.workSummary || 'none provided'}

Supervised session context:
${ctx.supervisedContext}

Question: Has ~80% of the aim requirements been met? Don't overengineer - we want "good enough" not "perfect".

Available actions (respond with ONE as JSON):

1. verify_complete - Work meets ~80% of requirements
   {"action": {"type": "verify_complete", "notes": "what looks good about the implementation"}}

   This will trigger:
   - Verify aim context check
   - Create git commit
   - Add reflection
   - Compact conversation
   - Return to EXPLORING

2. verify_incomplete - Work doesn't meet ~80% of requirements yet
   {"action": {"type": "verify_incomplete", "missing": "what's not complete yet"}}

   This will return to WORKING state with guidance on what's missing.

Verification guidelines:
- Check if core functionality works
- Don't require extensive tests if aim wasn't about testing
- Don't require perfect error handling if aim was about basic feature
- Don't require comprehensive docs if aim was about implementation
- Focus on "does it do what the aim asked for" not "is it production-perfect"

${marker}`
}

/**
 * ERROR state prompt
 */
function generateErrorPrompt(ctx: PromptContext, marker: string): string {
  return `[STATE: ERROR]

An error occurred in the autonomous loop.
Error count: ${ctx.metadata?.errorCount ?? 1}
Last error: ${ctx.metadata?.lastError ?? 'unknown'}
Previous state: ${ctx.metadata?.previousState ?? 'unknown'}

Supervised session context:
${ctx.supervisedContext}

Available actions (respond with ONE as JSON):

1. retry - Try to continue from previous state
   {"action": {"type": "retry", "reason": "supervised session looks responsive now"}}

2. reset - Reset to EXPLORING and start fresh
   {"action": {"type": "reset", "reason": "better to start over"}}

3. abort - Give up on current work
   {"action": {"type": "abort", "reason": "unrecoverable error"}}

${marker}`
}

/**
 * Extract valid action types for current state
 */
export function getValidActionsForState(state: AnimatorStateName): string[] {
  switch (state) {
    case 'EXPLORING':
      return ['start_work', 'break_down', 'ideate', 'wait']
    case 'WORKING':
      return ['proceed', 'wrap_up']
    case 'WRAPPING_UP':
      return ['verify_complete', 'verify_incomplete']
    case 'ERROR':
      return ['retry', 'reset', 'abort']
    default:
      return []
  }
}

/**
 * Validate if action is allowed in current state
 */
export function isValidAction(state: AnimatorStateName, actionType: string): boolean {
  const validActions = getValidActionsForState(state)
  return validActions.includes(actionType)
}
