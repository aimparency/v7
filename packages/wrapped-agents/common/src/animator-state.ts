/**
 * Animator State Machine
 *
 * Manages the autonomous loop state with 4 explicit states:
 * - EXPLORING: Find work, break down aims, ideate
 * - WORKING: Push supervised session to complete aim
 * - WRAPPING_UP: Verify ~80% complete, commit, reflect, compact
 * - ERROR: Handle timeouts with exponential backoff
 */

export type AnimatorStateName = 'EXPLORING' | 'WORKING' | 'WRAPPING_UP' | 'ERROR'

export interface StateContext {
  // Current aim being worked on
  aimId?: string
  aimText?: string
  strategy?: string

  // Timing
  workStartedAt?: number
  stateEnteredAt: number

  // Error handling
  errorCount: number
  lastCheckAt: number
  lastError?: string
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

  constructor() {
    this.context = {
      stateEnteredAt: Date.now(),
      errorCount: 0,
      lastCheckAt: Date.now()
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

      // Reset error count when transitioning out of ERROR
      if (this.currentState === 'ERROR' && newState !== 'ERROR') {
        this.context.errorCount = 0
      }

      // Save previous state when entering ERROR
      if (newState === 'ERROR') {
        this.context.previousState = this.currentState
      }

      // Clear aim context when returning to EXPLORING
      if (newState === 'EXPLORING') {
        this.context.aimId = undefined
        this.context.aimText = undefined
        this.context.strategy = undefined
        this.context.workStartedAt = undefined
      }
    }

    this.currentState = newState
  }

  /**
   * Update context (without changing state)
   */
  updateContext(updates: Partial<StateContext>): void {
    this.context = { ...this.context, ...updates }
  }

  /**
   * Start working on an aim
   */
  startWork(aimId: string, aimText: string, strategy: string): void {
    this.context.aimId = aimId
    this.context.aimText = aimText
    this.context.strategy = strategy
    this.context.workStartedAt = Date.now()
  }

  /**
   * Enter ERROR state with exponential backoff
   */
  enterError(error: string): void {
    this.context.errorCount++
    this.context.lastError = error
    this.context.lastCheckAt = Date.now()
    this.transition('ERROR', 'error_occurred', { error })
  }

  /**
   * Get next check delay for ERROR state (exponential backoff)
   * Returns delay in milliseconds
   */
  getErrorBackoffDelay(): number {
    // Exponential backoff: 1min, 2min, 4min, 8min, 15min (max)
    const delays = [60000, 120000, 240000, 480000, 900000]
    const delay = delays[Math.min(this.context.errorCount - 1, delays.length - 1)]
    return delay
  }

  /**
   * Check if enough time has passed for next error check
   */
  shouldCheckError(): boolean {
    if (this.currentState !== 'ERROR') return false
    const delay = this.getErrorBackoffDelay()
    const elapsed = Date.now() - this.context.lastCheckAt
    return elapsed >= delay
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
