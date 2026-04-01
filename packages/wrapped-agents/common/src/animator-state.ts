/**
 * Animator State Machine
 *
 * Manages the autonomous loop state with 3 explicit states:
 * - EXPLORING: Find work, break down aims, ideate
 * - WORKING: Push supervised session to complete aim
 * - WRAPPING_UP: Verify, update state/reflection, commit, and go explore again
 */

import { getTargetState, getValidActionNames } from './state-machine-definition'

export type AnimatorStateName = 'EXPLORING' | 'WORKING' | 'WRAPPING_UP'

export interface TransitionResult {
  success: boolean
  newState?: AnimatorStateName
  validActions?: string[]
  error?: string
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

  constructor() {
    this.context = {
      stateEnteredAt: Date.now()
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
      this.context.stateEnteredAt = Date.now()

      // Clear work context when returning to EXPLORING
      if (newState === 'EXPLORING') {
        this.context.aimText = undefined
        this.context.task = undefined
        this.context.reference = undefined
        this.context.strategy = undefined
        this.context.workStartedAt = undefined
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

    // Get target state for this action
    const targetState = getTargetState(currentState, actionType)

    if (!targetState) {
      // Action not valid for current state
      const validActions = getValidActionNames(currentState)
      return {
        success: false,
        validActions,
        error: `Action "${actionType}" is not valid in ${currentState} state`
      }
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
