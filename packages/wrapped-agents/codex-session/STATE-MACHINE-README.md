# Animator State Machine Implementation

## What Was Built

A complete state machine foundation for structured autonomous operation.

### Core Components

1. **animator-state.ts** - State machine class
   - Manages 4 states: EXPLORING, WORKING, WRAPPING_UP, ERROR
   - Tracks context (aim being worked on, timing, errors)
   - Records state transition history
   - Implements exponential backoff for ERROR state

2. **animator-prompts.ts** - Prompt generation
   - State-specific prompts (15-25 lines each vs 95-line INSTRUCT.md)
   - Only shows actions valid for current state
   - JSON response format with examples
   - Action validation helpers

3. **watchdog-state-machine.ts** - Integration methods
   - Action executors for each state transition
   - Helper methods for state management
   - Sequential operation support (verify → commit → reflect → compact)

4. **INTEGRATION-GUIDE.md** - How to integrate
   - Step-by-step guide to modify existing watchdog.ts
   - Complete code examples
   - Testing checklist

## State Machine Flow

```
EXPLORING → find work, break down aims, ideate
    ↓ (start_work)
WORKING → push supervised session to complete aim
    ↓ (wrap_up)
WRAPPING_UP → verify ~80%, commit, reflect, compact
    ↓ (verify_complete)
EXPLORING → loop continues

Any state can → ERROR (on timeout/failure)
    ERROR uses exponential backoff (1/2/4/8/15min)
    Can retry, reset, or abort back to work
```

## Actions by State

### EXPLORING
- **start_work** → WORKING (begin aim implementation)
- **break_down** → EXPLORING (decompose aim into sub-aims)
- **ideate** → EXPLORING (research, create new aims)
- **wait** → EXPLORING (nothing to do)

### WORKING
- **proceed** → WORKING (continue, motivate, select options, escalate)
- **wrap_up** → WRAPPING_UP (work appears complete)

### WRAPPING_UP
- **verify_complete** → EXPLORING (80% done, commit, reflect, compact)
- **verify_incomplete** → WORKING (not done, continue working)

### ERROR
- **retry** → previous state (attempt recovery)
- **reset** → EXPLORING (start fresh)
- **abort** → EXPLORING (give up on current work)

## Key Features

### 1. Focused Prompts
- **Before:** 95-line INSTRUCT.md with all possible guidance
- **After:** 15-25 line state-specific prompts
- **Token savings:** 67-83% per prompt

### 2. Observable State
- Every transition logged
- State history tracked (last 100 transitions)
- Export state for debugging: `animatorState.export()`

### 3. Structured Actions
- Actions validated against current state
- Invalid actions rejected with log
- Clear JSON response format

### 4. Error Recovery
- ERROR state with exponential backoff
- 1min → 2min → 4min → 8min → 15min delays
- Can retry, reset, or abort

### 5. Sequential Operations
- WRAPPING_UP executes: verify → commit → reflect → compact
- Waits for each step to complete before next
- Automatic loop back to EXPLORING

## Integration Status

**Status:** ✅ Core implementation complete, integration guide provided

**To integrate:**
1. Follow INTEGRATION-GUIDE.md
2. Modify watchdog.ts askWatchdog() method
3. Replace processDecision() to use state machine
4. Add state action handlers
5. Test with real aims

**Estimated effort:** 2-3 hours to integrate + test

## Example Usage

```typescript
// Initialize
const animatorState = new AnimatorState()

// Start work
animatorState.startWork('aim-123', 'Implement feature X', 'Use TDD approach')
animatorState.transition('WORKING', 'start_work')

// Generate prompt for current state
const prompt = generateSupervisorPrompt({
  state: 'WORKING',
  supervisedContext: '... last 40 lines ...',
  aimText: 'Implement feature X',
  workDuration: '5m 23s'
}, 'request-id-123')

// Process supervisor response
const action = { type: 'wrap_up', summary: 'Feature implemented' }
if (isValidAction('WORKING', action.type)) {
  // Execute action and transition
  animatorState.transition('WRAPPING_UP', 'wrap_up', action)
}
```

## Next Steps

1. **Integrate into watchdog.ts** (follow INTEGRATION-GUIDE.md)
2. **Test EXPLORING → WORKING flow**
3. **Test WRAPPING_UP verification**
4. **Test ERROR recovery**
5. **Add MCP calls** (get_prioritized_aims, get_aim_context, etc.)
6. **Add agent_log.json generation**
7. **Connect to actual project data** (phases, aims count, compute budget)

## Files Modified

**Created:**
- `packages/wrapped-agents/codex-session/src/animator-state.ts`
- `packages/wrapped-agents/codex-session/src/animator-prompts.ts`
- `packages/wrapped-agents/codex-session/src/watchdog-state-machine.ts`
- `packages/wrapped-agents/codex-session/INTEGRATION-GUIDE.md`
- `packages/wrapped-agents/codex-session/STATE-MACHINE-README.md`

**To modify:**
- `packages/wrapped-agents/codex-session/src/watchdog.ts` (follow integration guide)

## Architecture Decisions

1. **In-memory state** - No file persistence, state lives in session process
2. **4 states** - Simple, focused, covers all scenarios
3. **Explicit transitions** - All transitions logged and tracked
4. **Separate prompts** - Each state gets its own prompt template
5. **Action validation** - Invalid actions rejected, not executed

## Benefits vs Current Approach

| Aspect | Current | State Machine |
|--------|---------|--------------|
| Prompt size | 95 lines | 15-25 lines |
| State tracking | Implicit | Explicit |
| Observability | Logs only | State transitions + logs |
| Error handling | Retry logic | ERROR state + backoff |
| Action validation | None | Validated per state |
| Extensibility | Modify INSTRUCT.md | Add state/action |

---

**This implementation provides the foundation for observable, structured autonomous operation while maintaining the flexibility of LLM decision-making.**
