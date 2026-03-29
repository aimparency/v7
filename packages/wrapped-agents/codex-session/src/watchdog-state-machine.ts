/**
 * Watchdog State Machine Integration
 *
 * Extends WatchdogService with explicit state machine for structured autonomy.
 * Replaces the implicit "send everything to watchdog" approach with:
 * - Explicit states (EXPLORING, WORKING, WRAPPING_UP, ERROR)
 * - State-specific prompts (only relevant actions shown)
 * - State transitions tracked and logged
 */

import type { Agent } from './agent'
import { AnimatorState, type AnimatorStateName, type Action as StateAction } from './animator-state'
import { generateSupervisorPrompt, isValidAction, type PromptContext } from './animator-prompts'

const INSTRUCT_PATH = require('path').join(__dirname, '../../INSTRUCT.md')
let INSTRUCT_TEXT = ''
try {
  INSTRUCT_TEXT = require('fs').readFileSync(INSTRUCT_PATH, 'utf-8')
} catch (e) {
  console.warn('[WatchdogStateMachine] Could not load INSTRUCT.md:', e)
}

/**
 * State machine-aware watchdog methods
 * Mixin to add to WatchdogService
 */
export class WatchdogStateMachine {
  private state: AnimatorState
  private worker!: Agent
  private watchdog!: Agent
  private log!: (msg: string) => void
  private post!: (agent: Agent, text: string) => Promise<void>
  private wait!: (ms: number) => Promise<void>

  constructor() {
    this.state = new AnimatorState()
  }

  /**
   * Get current state name (for UI/logging)
   */
  getCurrentState(): AnimatorStateName {
    return this.state.getState()
  }

  /**
   * Get state machine export (for logging/debugging)
   */
  getStateExport(): object {
    return this.state.export()
  }

  /**
   * Generate supervisor prompt based on current state
   */
  generateStateBasedPrompt(requestId: string): string {
    const currentState = this.state.getState()
    const context = this.state.getContext()

    // Get supervised (worker) session context
    const rawContext = this.stripAnsi(this.worker.getLines(40))
    const supervisedContext = rawContext.replace(/\s+/g, ' ').trim()

    // Build prompt context
    const promptContext: PromptContext = {
      state: currentState,
      supervisedContext,
      // TODO: Get these from MCP or project state
      activePhases: [],
      openAimsCount: 0,
      computeCredits: 0
    }

    // Add state-specific context
    if (currentState === 'WORKING' || currentState === 'WRAPPING_UP') {
      promptContext.aimText = context.aimText
      const workDuration = this.state.getWorkDuration()
      if (workDuration !== null) {
        const minutes = Math.floor(workDuration / 60000)
        const seconds = Math.floor((workDuration % 60000) / 1000)
        promptContext.workDuration = `${minutes}m ${seconds}s`
      }
      promptContext.supervisedStatus = this.isGenerating(this.worker) ? 'busy' : 'idle'
    }

    if (currentState === 'ERROR') {
      promptContext.metadata = {
        errorCount: context.errorCount,
        lastError: context.lastError,
        previousState: context.previousState
      }
    }

    return generateSupervisorPrompt(promptContext, requestId)
  }

  /**
   * Process state machine action from supervisor
   */
  async processStateMachineAction(action: any): Promise<void> {
    const actionType = action.type
    const currentState = this.state.getState()

    this.log(`[StateMachine] Current state: ${currentState}, Action: ${actionType}`)

    // Validate action is allowed in current state
    if (!isValidAction(currentState, actionType)) {
      this.log(`[StateMachine] Invalid action "${actionType}" for state "${currentState}". Ignoring.`)
      return
    }

    // Execute action based on current state
    switch (currentState) {
      case 'EXPLORING':
        await this.handleExploringAction(action)
        break
      case 'WORKING':
        await this.handleWorkingAction(action)
        break
      case 'WRAPPING_UP':
        await this.handleWrappingUpAction(action)
        break
      case 'ERROR':
        await this.handleErrorAction(action)
        break
    }
  }

  /**
   * Handle actions in EXPLORING state
   */
  private async handleExploringAction(action: any): Promise<void> {
    switch (action.type) {
      case 'start_work':
        await this.executeStartWork(action.aim_id, action.aim_text, action.strategy)
        this.state.startWork(action.aim_id, action.aim_text, action.strategy)
        this.state.transition('WORKING', 'start_work', action)
        break

      case 'break_down':
        await this.executeBreakDown(action.aim_id)
        // Stay in EXPLORING
        break

      case 'ideate':
        await this.executeIdeate(action.ideation_type)
        // Stay in EXPLORING
        break

      case 'wait':
        this.log(`[StateMachine] Waiting: ${action.reason}`)
        // Stay in EXPLORING
        break

      default:
        this.log(`[StateMachine] Unknown EXPLORING action: ${action.type}`)
    }
  }

  /**
   * Handle actions in WORKING state
   */
  private async handleWorkingAction(action: any): Promise<void> {
    switch (action.type) {
      case 'proceed':
        await this.executeProceed(action.proceed_type, action)
        // Stay in WORKING
        break

      case 'wrap_up':
        this.log(`[StateMachine] Wrapping up: ${action.summary}`)
        this.state.updateContext({ metadata: { workSummary: action.summary } })
        this.state.transition('WRAPPING_UP', 'wrap_up', action)
        break

      default:
        this.log(`[StateMachine] Unknown WORKING action: ${action.type}`)
    }
  }

  /**
   * Handle actions in WRAPPING_UP state
   */
  private async handleWrappingUpAction(action: any): Promise<void> {
    switch (action.type) {
      case 'verify_complete':
        await this.executeVerifyComplete(action.notes)
        this.state.transition('EXPLORING', 'verify_complete', action)
        break

      case 'verify_incomplete':
        await this.executeVerifyIncomplete(action.missing)
        this.state.transition('WORKING', 'verify_incomplete', action)
        break

      default:
        this.log(`[StateMachine] Unknown WRAPPING_UP action: ${action.type}`)
    }
  }

  /**
   * Handle actions in ERROR state
   */
  private async handleErrorAction(action: any): Promise<void> {
    const context = this.state.getContext()
    const previousState = context.previousState || 'EXPLORING'

    switch (action.type) {
      case 'retry':
        this.log(`[StateMachine] Retrying from ERROR, returning to ${previousState}`)
        this.state.transition(previousState, 'retry', action)
        break

      case 'reset':
        this.log(`[StateMachine] Resetting from ERROR to EXPLORING`)
        this.state.transition('EXPLORING', 'reset', action)
        break

      case 'abort':
        this.log(`[StateMachine] Aborting from ERROR: ${action.reason}`)
        this.state.transition('EXPLORING', 'abort', action)
        break

      default:
        this.log(`[StateMachine] Unknown ERROR action: ${action.type}`)
    }
  }

  // ========== Action Executors ==========

  /**
   * Execute: start_work
   */
  private async executeStartWork(aimId: string, aimText: string, strategy: string): Promise<void> {
    this.log(`[StateMachine] Starting work on aim: ${aimText}`)

    // TODO: Call MCP to get aim context
    // For now, send INSTRUCT with aim info

    const prompt = `${INSTRUCT_TEXT}

---

Work on this aim:
ID: ${aimId}
Text: ${aimText}
Strategy: ${strategy}

Begin implementation.`

    await this.post(this.worker, prompt)
  }

  /**
   * Execute: break_down
   */
  private async executeBreakDown(aimId: string): Promise<void> {
    this.log(`[StateMachine] Breaking down aim: ${aimId}`)

    const prompt = `Break down this aim into smaller sub-aims. Use the create_aim MCP tool to create sub-aims with the parent aim's ID in supportedAims array.

Aim to break down: ${aimId}

Create 2-5 sub-aims that together accomplish the parent aim.`

    await this.post(this.worker, prompt)
  }

  /**
   * Execute: ideate
   */
  private async executeIdeate(ideationType: string): Promise<void> {
    this.log(`[StateMachine] Ideating: ${ideationType}`)

    let prompt = ''
    switch (ideationType) {
      case 'research':
        prompt = 'Do web research on relevant topics for this project. Create aims for insights discovered.'
        break
      case 'new_aims':
        prompt = 'Review the codebase and create aims for improvements: refactoring, tests, docs, security, performance.'
        break
      case 'improvements':
        prompt = 'Review recent work and suggest optimizations or improvements as aims.'
        break
      default:
        prompt = 'Think about what could be improved and create aims for it.'
    }

    await this.post(this.worker, prompt)
  }

  /**
   * Execute: proceed
   */
  private async executeProceed(proceedType: string, action: any): Promise<void> {
    switch (proceedType) {
      case 'none':
        this.log(`[StateMachine] Proceeding with monitoring (no action)`)
        break

      case 'motivate':
        this.log(`[StateMachine] Sending motivational prompt`)
        await this.post(this.worker, action.text || 'Keep working on the aim.')
        break

      case 'option_select':
        this.log(`[StateMachine] Selecting option: ${action.choice}`)
        await this.post(this.worker, action.choice)
        break

      case 'escalate':
        this.log(`[StateMachine] Escalating to human: ${action.question}`)
        // TODO: Implement human escalation
        // For now, just log and wait
        break

      default:
        this.log(`[StateMachine] Unknown proceed type: ${proceedType}`)
    }
  }

  /**
   * Execute: verify_complete
   */
  private async executeVerifyComplete(notes: string): Promise<void> {
    this.log(`[StateMachine] Verifying complete: ${notes}`)

    // Step 1: Verify aim context
    await this.post(this.worker, 'Use get_aim_context MCP tool to verify the aim is complete.')
    await this.waitForWorkerIdle()

    // Step 2: Create git commit
    await this.post(this.worker, 'Track changes and create git commit. Use `git add -u` then `git add` for new files, then commit.')
    await this.waitForWorkerIdle()

    // Step 3: Add reflection
    await this.post(this.worker, 'Add structured reflection for the completed aim using addReflection MCP tool.')
    await this.waitForWorkerIdle()

    // Step 4: Compact
    this.log(`[StateMachine] Compacting conversation after aim completion`)
    await this.post(this.watchdog, '/compact')
  }

  /**
   * Execute: verify_incomplete
   */
  private async executeVerifyIncomplete(missing: string): Promise<void> {
    this.log(`[StateMachine] Work incomplete, returning to working: ${missing}`)

    const prompt = `Work is not complete yet. Missing:
${missing}

Continue working on the aim to address these items.`

    await this.post(this.worker, prompt)
  }

  /**
   * Enter ERROR state
   */
  enterErrorState(error: string): void {
    this.log(`[StateMachine] Entering ERROR state: ${error}`)
    this.state.enterError(error)
  }

  /**
   * Check if should attempt error recovery
   */
  shouldAttemptErrorRecovery(): boolean {
    return this.state.shouldCheckError()
  }

  // ========== Helper Methods ==========

  /**
   * Wait for worker to become idle (for use in sequential operations)
   */
  private async waitForWorkerIdle(): Promise<void> {
    // Wait a bit for command to start
    await this.wait(2000)

    // Poll until idle
    for (let i = 0; i < 60; i++) {  // Max 60 seconds
      if (!this.isGenerating(this.worker)) {
        const lines = this.worker.getLines(10)
        await this.wait(1000)
        const linesAgain = this.worker.getLines(10)
        if (lines === linesAgain) {
          return  // Truly idle
        }
      }
      await this.wait(1000)
    }

    this.log('[StateMachine] WARNING: Timeout waiting for worker idle')
  }

  /**
   * Placeholder methods (to be provided by WatchdogService)
   */
  private stripAnsi(str: string): string {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
  }

  private isGenerating(agent: Agent): boolean {
    // This should be provided by WatchdogService
    return false
  }
}
