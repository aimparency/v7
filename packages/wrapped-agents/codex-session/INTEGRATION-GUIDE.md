# State Machine Integration Guide

## Overview

This guide explains how to integrate the state machine into the existing `watchdog.ts`.

## Files Created

1. **animator-state.ts** - Core state machine class
2. **animator-prompts.ts** - State-specific prompt generation
3. **watchdog-state-machine.ts** - Integration methods

## Integration Steps

### Step 1: Import State Machine

Add imports to `watchdog.ts`:

```typescript
import { AnimatorState } from './animator-state'
import { generateSupervisorPrompt, isValidAction } from './animator-prompts'
import type { PromptContext } from './animator-prompts'
```

### Step 2: Add State Machine Property

In `WatchdogService` class, add:

```typescript
export class WatchdogService {
  // ... existing properties ...

  private animatorState: AnimatorState = new AnimatorState()
}
```

### Step 3: Replace askWatchdog() Method

Replace the existing `askWatchdog()` method with state-based version:

```typescript
async askWatchdog() {
  this.log("Asking Watchdog for guidance...");

  if (!this.worker || !this.watchdog) {
    this.log("Cannot ask watchdog: agents not initialized");
    return;
  }

  this.waitingForResponseStart = true;
  this.waitingForResponse = false;
  this.retryCount = 0;
  this.responseRequestedAt = Date.now();
  this.responseSawGenerating = false;
  this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;

  // Get supervised session context
  const rawContext = stripAnsi(this.worker.getLines(40));
  const supervisedContext = rawContext.replace(/\s+/g, ' ').trim();

  // Get current state
  const currentState = this.animatorState.getState();
  const stateContext = this.animatorState.getContext();

  this.log(`[StateMachine] Current state: ${currentState}`);

  // Build prompt context
  const promptContext: PromptContext = {
    state: currentState,
    supervisedContext,
    // TODO: Get these from MCP or project state
    activePhases: [],
    openAimsCount: 0,
    computeCredits: 0
  };

  // Add state-specific context
  if (currentState === 'WORKING' || currentState === 'WRAPPING_UP') {
    promptContext.aimText = stateContext.aimText;
    const workDuration = this.animatorState.getWorkDuration();
    if (workDuration !== null) {
      const minutes = Math.floor(workDuration / 60000);
      const seconds = Math.floor((workDuration % 60000) / 1000);
      promptContext.workDuration = `${minutes}m ${seconds}s`;
    }
    promptContext.supervisedStatus = this.isGenerating(this.worker) ? 'busy' : 'idle';
  }

  if (currentState === 'ERROR') {
    promptContext.metadata = {
      errorCount: stateContext.errorCount,
      lastError: stateContext.lastError,
      previousState: stateContext.previousState
    };
  }

  // Generate request ID and prompt
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  this.currentPromptMarker = `Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks). [${requestId}]`;

  const question = generateSupervisorPrompt(promptContext, requestId);

  this.log(`[StateMachine] Generated ${currentState} prompt, length: ${question.length}`);
  this.log(`DEBUG: Question (first 500 chars):\n${question.substring(0, 500)}`);

  await this.post(this.watchdog, question);

  await this.wait(500);
  const isProcessing = this.isGenerating(this.watchdog);
  this.log(`DEBUG: Is watchdog generating after post? ${isProcessing}`);
}
```

### Step 4: Replace processDecision() Method

Replace the existing `processDecision()` method:

```typescript
async processDecision(jsonString: string) {
  this.waitingForResponseStart = false;
  this.waitingForResponse = false;
  this.log(`Processing decision JSON length: ${jsonString.length}`);

  try {
    this.log(`Parsing JSON: ${jsonString}`);
    jsonString = jsonString.replace(/[\r\n]+/g, ' ');
    const decision = JSON.parse(jsonString);

    if (decision.action) {
      await this.processStateMachineAction(decision.action);
    }
  } catch (e: any) {
    this.log(`Error parsing JSON decision: ${e.message}`);
    this.retry(e.message);
  }
}
```

### Step 5: Add processStateMachineAction() Method

Add new method to handle state machine actions:

```typescript
async processStateMachineAction(action: any): Promise<void> {
  const actionType = action.type;
  const currentState = this.animatorState.getState();

  this.log(`[StateMachine] Processing action "${actionType}" in state "${currentState}"`);

  // Validate action
  if (!isValidAction(currentState, actionType)) {
    this.log(`[StateMachine] Invalid action "${actionType}" for state "${currentState}". Ignoring.`);
    return;
  }

  // Execute based on state
  switch (currentState) {
    case 'EXPLORING':
      await this.handleExploringAction(action);
      break;
    case 'WORKING':
      await this.handleWorkingAction(action);
      break;
    case 'WRAPPING_UP':
      await this.handleWrappingUpAction(action);
      break;
    case 'ERROR':
      await this.handleErrorAction(action);
      break;
  }

  this.nextCheckTime = Date.now() + POST_ACTION_COOLDOWN;
}
```

### Step 6: Add State Action Handlers

Add these handler methods:

```typescript
private async handleExploringAction(action: any): Promise<void> {
  switch (action.type) {
    case 'start_work':
      await this.executeStartWork(action.aim_id, action.aim_text, action.strategy);
      this.animatorState.startWork(action.aim_id, action.aim_text, action.strategy);
      this.animatorState.transition('WORKING', 'start_work', action);
      break;

    case 'break_down':
      await this.executeBreakDown(action.aim_id);
      break;

    case 'ideate':
      await this.executeIdeate(action.ideation_type);
      break;

    case 'wait':
      this.log(`[StateMachine] Waiting: ${action.reason || 'no reason'}`);
      break;
  }
}

private async handleWorkingAction(action: any): Promise<void> {
  switch (action.type) {
    case 'proceed':
      await this.executeProceed(action);
      break;

    case 'wrap_up':
      this.log(`[StateMachine] Wrapping up: ${action.summary || 'no summary'}`);
      this.animatorState.updateContext({ metadata: { workSummary: action.summary } });
      this.animatorState.transition('WRAPPING_UP', 'wrap_up', action);
      break;
  }
}

private async handleWrappingUpAction(action: any): Promise<void> {
  switch (action.type) {
    case 'verify_complete':
      await this.executeVerifyComplete(action.notes);
      this.animatorState.transition('EXPLORING', 'verify_complete', action);
      break;

    case 'verify_incomplete':
      await this.executeVerifyIncomplete(action.missing);
      this.animatorState.transition('WORKING', 'verify_incomplete', action);
      break;
  }
}

private async handleErrorAction(action: any): Promise<void> {
  const context = this.animatorState.getContext();
  const previousState = context.previousState || 'EXPLORING';

  switch (action.type) {
    case 'retry':
      this.log(`[StateMachine] Retrying, returning to ${previousState}`);
      this.animatorState.transition(previousState, 'retry', action);
      break;

    case 'reset':
      this.log(`[StateMachine] Resetting to EXPLORING`);
      this.animatorState.transition('EXPLORING', 'reset', action);
      break;

    case 'abort':
      this.log(`[StateMachine] Aborting: ${action.reason || 'no reason'}`);
      this.animatorState.transition('EXPLORING', 'abort', action);
      break;
  }
}
```

### Step 7: Add Action Executors

Add these execution methods:

```typescript
private async executeStartWork(aimId: string, aimText: string, strategy: string): Promise<void> {
  this.log(`[StateMachine] Starting work on: ${aimText}`);

  const prompt = `${this.instructTextWithMemory}

---

Work on this aim:
ID: ${aimId}
Text: ${aimText}
Strategy: ${strategy}

Begin implementation.`;

  await this.post(this.worker, prompt);
}

private async executeBreakDown(aimId: string): Promise<void> {
  this.log(`[StateMachine] Breaking down aim: ${aimId}`);

  const prompt = `Break down this aim into smaller sub-aims. Use create_aim MCP tool with supportedAims array pointing to parent: ${aimId}`;

  await this.post(this.worker, prompt);
}

private async executeIdeate(ideationType: string): Promise<void> {
  this.log(`[StateMachine] Ideating: ${ideationType}`);

  const prompts = {
    research: 'Do web research on relevant topics. Create aims for insights.',
    new_aims: 'Review codebase and create aims for improvements: refactoring, tests, docs, security, performance.',
    improvements: 'Review recent work and suggest optimizations as aims.'
  };

  const prompt = prompts[ideationType as keyof typeof prompts] || 'Think about improvements and create aims.';
  await this.post(this.worker, prompt);
}

private async executeProceed(action: any): Promise<void> {
  const proceedType = action.proceed_type;

  switch (proceedType) {
    case 'none':
      this.log(`[StateMachine] Monitoring (no action)`);
      break;

    case 'motivate':
      this.log(`[StateMachine] Sending motivation`);
      await this.post(this.worker, action.text || 'Keep working on the aim.');
      break;

    case 'option_select':
      this.log(`[StateMachine] Selecting option: ${action.choice}`);
      await this.post(this.worker, action.choice);
      break;

    case 'escalate':
      this.log(`[StateMachine] Escalating: ${action.question}`);
      // TODO: Implement human escalation
      break;
  }
}

private async executeVerifyComplete(notes: string): Promise<void> {
  this.log(`[StateMachine] Verify complete: ${notes}`);

  // Step 1: Verify
  await this.post(this.worker, 'Use get_aim_context to verify aim is complete.');
  await this.waitForWorkerIdle();

  // Step 2: Commit
  await this.post(this.worker, 'Create git commit. Use git add -u, then git add for new files, then commit.');
  await this.waitForWorkerIdle();

  // Step 3: Reflect
  await this.post(this.worker, 'Add reflection using addReflection MCP tool.');
  await this.waitForWorkerIdle();

  // Step 4: Compact
  this.turnCount = 0;
  await this.post(this.watchdog, '/compact');
}

private async executeVerifyIncomplete(missing: string): Promise<void> {
  this.log(`[StateMachine] Incomplete: ${missing}`);

  const prompt = `Work not complete. Missing: ${missing}. Continue working.`;
  await this.post(this.worker, prompt);
}

private async waitForWorkerIdle(): Promise<void> {
  await this.wait(2000);
  for (let i = 0; i < 60; i++) {
    if (!this.isGenerating(this.worker)) {
      const lines = this.worker.getLines(10);
      await this.wait(1000);
      if (lines === this.worker.getLines(10)) return;
    }
    await this.wait(1000);
  }
  this.log('[StateMachine] Warning: timeout waiting for worker idle');
}
```

### Step 8: Update Error Handling

Modify the `tick()` method to handle ERROR state:

In the `tick()` method, add error state handling in the catch block:

```typescript
} catch (e) {
  console.error('[WatchdogService] Error in tick:', e);
  this.animatorState.enterError(String(e));
} finally {
  this.processing = false;
}
```

Add ERROR state check in tick():

```typescript
async tick() {
  if (!this.enabled) return;
  if (this.processing) return;

  // Check if in ERROR state with backoff
  if (this.animatorState.getState() === 'ERROR') {
    if (!this.animatorState.shouldCheckError()) {
      const delay = this.animatorState.getErrorBackoffDelay();
      this.nextCheckTime = Date.now() + delay;
      return;
    }
    this.log('[StateMachine] Error backoff period elapsed, asking watchdog');
  }

  if (Date.now() < this.nextCheckTime) return;

  // ... rest of tick logic ...
}
```

## Testing

1. **Start with EXPLORING state:**
   - Enable animator
   - Should ask watchdog with EXPLORING prompt
   - Watchdog should respond with start_work, break_down, or ideate

2. **Transition to WORKING:**
   - start_work action should send INSTRUCT + aim to worker
   - State should transition to WORKING
   - Next prompt should show WORKING actions only

3. **Complete work:**
   - wrap_up action transitions to WRAPPING_UP
   - verify_complete triggers: verify → commit → reflect → compact → EXPLORING

4. **Error handling:**
   - Timeout or parse error enters ERROR state
   - Exponential backoff delays checks
   - Can retry, reset, or abort

## Benefits

- **Focused prompts:** 15-25 lines vs 95 lines
- **Observable:** State transitions logged
- **Structured:** Clear action validation
- **Resilient:** ERROR state with backoff
- **Extensible:** Easy to add new states/actions

## Rollback

To revert to old behavior, simply don't call `processStateMachineAction` - call the old `executeAction` instead in `processDecision`.
