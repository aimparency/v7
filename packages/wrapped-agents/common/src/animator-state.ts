/**
 * Animator State Machine
 *
 * Manages the autonomous loop state with 3 explicit states:
 * - EXPLORING: Find work, break down aims, ideate
 * - WORKING: Push supervised session to complete aim
 * - WRAPPING_UP: Verify, update state/reflection, commit, and go explore again
 */

import { getTargetState, getValidActionNames } from './state-machine-definition'

export type AnimatorStateName = 'EXPLORING' | 'WORKING' | 'WRAPPING_UP' | 'ERROR'

export interface TransitionResult {
  success: boolean
  newState?: AnimatorStateName
  validActions?: string[]
  error?: string
  backoffActive?: boolean
  nextRetryAt?: number
}

export interface StateContext {
  // Current work being tracked
  aimText?: string
  task?: string
  reference?: string
  strategy?: string

  // Timing
  workStartedAt?: number
  stateEnteredAt: number

  // Error handling
  errorCount: number
  previousState?: AnimatorStateName

  // Other context
  metadata?: Record<string, any>
}

export interface StateTransition {
  from: AnimatorStateName
  to: AnimatorStateName
  action: string
  timestamp: number
  data?: any
}

export interface ActionMessage {
  type: string
  [key: string]: any
}

/**
 * AnimatorState class manages the state machine
 */
export class AnimatorState {
  private currentState: AnimatorStateName = 'EXPLORING'
  private context: StateContext
  private history: StateTransition[] = []

  // Backoff schedule in minutes: 1, 2, 4, 8, 15 (max)
  private static readonly BACKOFF_SCHEDULE = [1, 2, 4, 8, 15];

  constructor() {
    this.context = {
      stateEnteredAt: Date.now(),
      errorCount: 0
    }
  }

  /**
   * Get current state name
   */
  getState(): AnimatorStateName {
    return this.currentState
  }

  /**
   * Get state context
   */
  getContext(): Readonly<StateContext> {
    return { ...this.context }
  }

  /**
   * Get transition history
   */
  getHistory(): ReadonlyArray<StateTransition> {
    return [...this.history]
  }

  /**
   * Transition to a new state
   */
  transition(newState: AnimatorStateName, action: string, data?: any): void {
    const transition: StateTransition = {
      from: this.currentState,
      to: newState,
      action,
      timestamp: Date.now(),
      data
    }

    this.history.push(transition)

    // Trim history to last 100 transitions
    if (this.history.length > 100) {
      this.history = this.history.slice(-100)
    }

    // Update context on transition
    if (newState !== this.currentState) {
      // If entering ERROR, record previous state and increment count
      if (newState === 'ERROR') {
        this.context.previousState = this.currentState;
        this.context.errorCount++;
      } else if (action === 'retry') {
        // Successful retry - we don't clear errorCount yet, 
        // maybe it should clear after some successful work?
        // For now, let's keep it until it's manually reset or new work starts.
      } else if (newState !== 'EXPLORING') {
        // Clear error count when moving to a new normal state (e.g. WORKING)
        // unless it's a retry transition.
        this.context.errorCount = 0;
        this.context.previousState = undefined;
      }

      this.context.stateEnteredAt = Date.now()

      // Clear work context when returning to EXPLORING
      if (newState === 'EXPLORING') {
        this.context.aimText = undefined
        this.context.task = undefined
        this.context.reference = undefined
        this.context.strategy = undefined
        this.context.workStartedAt = undefined
        this.context.errorCount = 0;
        this.context.previousState = undefined;
      }
    }

    this.currentState = newState
  }

  /**
   * Attempt to perform an action and transition
   * Validates action is allowed in current state
   * Returns result indicating success/failure
   */
  attemptAction(action: ActionMessage): TransitionResult {
    const actionType = action.type
    const currentState = this.currentState

    // Check backoff if in ERROR state
    if (currentState === 'ERROR') {
      const delay = this.getErrorBackoffDelay();
      const nextRetryAt = this.context.stateEnteredAt + delay;
      if (Date.now() < nextRetryAt) {
        return {
          success: false,
          error: `In backoff period. Next retry allowed at ${new Date(nextRetryAt).toLocaleTimeString()}`,
          backoffActive: true,
          nextRetryAt
        }
      }
    }

    // Get target state for this action
    let targetState = getTargetState(currentState, actionType)

    if (!targetState) {
      // Action not valid for current state
      const validActions = getValidActionNames(currentState)
      return {
        success: false,
        validActions,
        error: `Action "${actionType}" is not valid in ${currentState} state`
      }
    }

    // Special handling for PREVIOUS_STATE meta-target
    if (targetState === 'PREVIOUS_STATE') {
      targetState = this.context.previousState || 'EXPLORING';
    }

    const newState = targetState as AnimatorStateName

    // Valid action - perform transition
    this.transition(newState, actionType, action)

    return {
      success: true,
      newState
    }
  }

  /**
   * Manually trigger an error transition (e.g. on timeout)
   */
  triggerError(reason: string): void {
    if (this.currentState === 'ERROR') return; // Already in ERROR
    this.transition('ERROR', 'error_detected', { reason });
  }

  /**
   * Get backoff delay for current error count in ms
   */
  getErrorBackoffDelay(): number {
    if (this.context.errorCount === 0) return 0;
    const index = Math.min(this.context.errorCount - 1, AnimatorState.BACKOFF_SCHEDULE.length - 1);
    return AnimatorState.BACKOFF_SCHEDULE[index] * 60 * 1000;
  }

  /**
   * Update context (without changing state)
   */
  updateContext(updates: Partial<StateContext>): void {
    this.context = { ...this.context, ...updates }
  }

  /**
   * Start tracking a concrete task
   */
  startWork(message: string): void {
    this.context.aimText = message
    this.context.task = message
    this.context.reference = undefined
    this.context.strategy = undefined
    this.context.workStartedAt = Date.now()
  }

  /**
   * Get time elapsed in current state (milliseconds)
   */
  getTimeInState(): number {
    return Date.now() - this.context.stateEnteredAt
  }

  /**
   * Get time spent working on current aim (milliseconds)
   */
  getWorkDuration(): number | null {
    if (!this.context.workStartedAt) return null
    return Date.now() - this.context.workStartedAt
  }

  /**
   * Export state for logging/debugging
   */
  export(): object {
    return {
      currentState: this.currentState,
      context: this.context,
      timeInState: this.getTimeInState(),
      workDuration: this.getWorkDuration(),
      recentTransitions: this.history.slice(-5)
    }
  }
}
