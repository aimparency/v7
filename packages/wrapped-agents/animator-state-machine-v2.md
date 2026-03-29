# Animator State Machine v2 (Final Design)

## Architecture

**Two Sessions:**
1. **Supervised Session (Main)** - Claude/Gemini/Codex doing actual work
2. **Supervising Session (Animator)** - Makes decisions based on state machine

**Flow:**
1. Supervised session becomes idle or reaches checkpoint
2. State engine checks current state
3. Supervisor session prompted with:
   - Main session context (current output/situation)
   - Available actions for current state (JSON format only, not full explanations)
4. Supervisor responds with JSON action
5. Action executed in supervised session
6. State transitions
7. Loop continues

---

## State Machine (4 States)

```
┌────────────┐
│  EXPLORING │ ←──────────────┐
└─────┬──────┘                │
      │                       │
      ↓                       │
┌────────────┐                │
│  WORKING   │ ←──┐           │
└─────┬──────┘   │           │
      │          │           │
      ↓          │           │
┌────────────┐   │           │
│WRAPPING-UP │───┘           │
└─────┬──────┘               │
      │                      │
      └──────────────────────┘

      Any state can go to ERROR
           ↓
     ┌────────────┐
     │   ERROR    │ (exponential backoff)
     └────────────┘
```

---

## State Persistence

**In-Memory Only**
- State stored in session process memory
- No file persistence needed
- Sessions don't typically close unexpectedly
- If session crashes, user restarts manually

```typescript
class AnimatorState {
  currentState: 'EXPLORING' | 'WORKING' | 'WRAPPING_UP' | 'ERROR'
  context: {
    aimId?: string
    aimText?: string
    strategy?: string
    workStartedAt?: number
    errorCount?: number
    lastCheckAt?: number
  }
  history: StateTransition[]
}
```

---

## State 1: EXPLORING

**Purpose:** Find work, break down aims, ideate

**Supervisor Prompt:**
```
[STATE: EXPLORING]

Main session context:
{last 20 lines of supervised session output}

Current situation:
- Active phases: {phase_list}
- Open aims count: {count}
- Compute budget: {credits}

Actions:
{"action": "start_work", "aim_id": "uuid", "aim_text": "...", "strategy": "..."}
{"action": "break_down", "aim_id": "uuid"}
{"action": "ideate", "type": "research|new_aims|improvements"}

Choose action as JSON:
```

**Actions:**

1. **start_work** → WORKING
   - Supervisor chooses aim to work on
   - Provides aim_id, aim_text, strategy
   - Engine sends work prompt to supervised session

2. **break_down** → EXPLORING (stay)
   - Supervisor identifies complex aim
   - Engine prompts supervised session to create sub-aims
   - Loops back to exploring

3. **ideate** → EXPLORING (stay)
   - Type: research, new_aims, improvements
   - Engine prompts supervised session accordingly
   - Loops back to exploring

---

## State 2: WORKING

**Purpose:** Push supervised session to complete aim

**Supervisor Prompt:**
```
[STATE: WORKING]

Aim: {aim_text}
Elapsed: {duration}

Main session context:
{last 30 lines of supervised session output}

Main session status: {idle|busy|waiting_for_input}

Actions:
{"action": "proceed", "type": "motivate|option_select|none"}
{"action": "wrap_up", "summary": "..."}

Choose action as JSON:
```

**Actions:**

1. **proceed** → WORKING (stay)
   - **motivate:** Send encouraging prompt to supervised
   - **option_select:** Detect options (A/B/C), supervisor chooses, send to supervised
   - **none:** Just keep monitoring

2. **wrap_up** → WRAPPING_UP
   - Work appears complete
   - Transition to verification

**User Interaction Handling:**

When supervised session shows options like `(A) option1 (B) option2`:
1. Supervisor session sees options in context
2. Supervisor chooses based on aim context
3. Engine sends choice to supervised stdin
4. Work continues

For critical decisions, supervisor can choose:
```json
{"action": "proceed", "type": "escalate", "question": "..."}
```
Engine pauses, alerts user, waits for human input.

---

## State 3: WRAPPING_UP

**Purpose:** Verify ~80% complete, commit, reflect, compact

**Supervisor Prompt:**
```
[STATE: WRAPPING_UP]

Completed aim: {aim_text}

Main session context:
{last 50 lines of supervised session output}

Check: Has ~80% of requirements been met? (Don't overengineer)

Actions:
{"action": "verify", "verdict": "complete|incomplete", "notes": "..."}

Choose action as JSON:
```

**Actions:**

1. **verify** with verdict "complete" → EXPLORING
   - Supervisor judges ~80% requirements met
   - Engine prompts supervised:
     - "Check aim context, verify basics"
     - "Create git commit for this work"
     - "Add reflection using addReflection MCP"
   - After all three complete: **Compact conversation**
   - Then transition to EXPLORING

2. **verify** with verdict "incomplete" → WORKING
   - Supervisor judges not ~80% done
   - Provides notes on what's missing
   - Transition back to WORKING
   - Engine prompts supervised with missing items

**Sequence in WRAPPING_UP (when complete):**
1. Supervised session verifies aim context
2. Supervised session creates git commit
3. Supervised session adds reflection
4. Engine compacts conversation history
5. Transition to EXPLORING

---

## State 4: ERROR

**Purpose:** Handle timeouts, stuck states, errors

**Entry Conditions:**
- Supervised session timeout (no response for X minutes)
- Stuck in same state too long
- Repeated failures
- Parse errors in supervisor responses

**Behavior:**
```typescript
class ErrorHandler {
  errorCount: number = 0
  lastCheckAt: number = Date.now()

  getNextCheckDelay(): number {
    // Exponential backoff: 1min, 2min, 4min, 8min, 15min (max)
    const delays = [60000, 120000, 240000, 480000, 900000]
    const delay = delays[Math.min(this.errorCount, delays.length - 1)]
    return delay
  }

  async tick() {
    const now = Date.now()
    const delay = this.getNextCheckDelay()

    if (now - this.lastCheckAt < delay) {
      return // Not time to check yet
    }

    // Send health check message to supervisor session
    await this.sendHealthCheck()
    this.lastCheckAt = now
    this.errorCount++

    // If supervisor responds, try to recover
    if (this.supervisorResponded()) {
      this.errorCount = 0
      return this.attemptRecovery()
    }
  }

  async attemptRecovery() {
    // Try to determine state and continue
    // Or transition to EXPLORING to start fresh
  }
}
```

**Recovery Actions:**
```json
{"action": "retry", "from_state": "WORKING"}
{"action": "reset", "to_state": "EXPLORING"}
{"action": "abort", "reason": "..."}
```

**User Override:**
User can always:
- Stop automation (disable animator)
- Start automation (enable animator)
- Chat manually in supervised session
- These controls already exist in UI

---

## Implementation Architecture

### Two Session Processes

```typescript
class WatchdogService {
  supervised: Agent      // Main worker (Claude/Gemini/Codex)
  supervisor: Agent      // Animator making decisions

  state: AnimatorState   // In-memory state

  async tick() {
    // Check if supervised session idle
    if (!this.isSupvisedIdle()) return

    // Generate supervisor prompt for current state
    const prompt = this.generateSupervisorPrompt()

    // Send to supervisor session
    const response = await this.supervisor.sendPrompt(prompt)

    // Parse JSON action
    const action = this.parseAction(response)

    // Execute action (prompts supervised session)
    await this.executeAction(action)

    // Transition state
    this.transitionState(action)
  }

  generateSupervisorPrompt(): string {
    const context = this.getSupervisedContext() // Last N lines
    const availableActions = this.getActionsForState(this.state.currentState)

    return `
[STATE: ${this.state.currentState}]

Main session context:
${context}

${this.getStateSpecificInfo()}

Available actions:
${availableActions.map(a => JSON.stringify(a)).join('\n')}

Respond with JSON action:
    `
  }

  async executeAction(action: Action) {
    switch(action.action) {
      case 'start_work':
        await this.startWork(action.aim_id, action.strategy)
        break
      case 'proceed':
        await this.proceedWork(action.type)
        break
      case 'wrap_up':
        // Just transition, verification happens in WRAPPING_UP
        break
      case 'verify':
        await this.verify(action.verdict, action.notes)
        break
      // ... etc
    }
  }

  async startWork(aimId: string, strategy: string) {
    // Get aim context
    const context = await mcp.get_aim_context(aimId)

    // Send to supervised session
    const prompt = `
${INSTRUCT_TEXT}

Work on this aim:
${context}

Strategy: ${strategy}

Begin implementation.
    `

    await this.supervised.sendPrompt(prompt)
  }

  async verify(verdict: 'complete' | 'incomplete', notes: string) {
    if (verdict === 'incomplete') {
      // Back to working
      await this.supervised.sendPrompt(`
Work is not complete yet. Missing:
${notes}

Continue working on the aim.
      `)
      return
    }

    // Complete: verify, commit, reflect, compact
    await this.supervised.sendPrompt('Verify aim context - is work complete?')
    await this.waitForIdle()

    await this.supervised.sendPrompt('Create git commit for completed work. Use git add -u then git add for new files.')
    await this.waitForIdle()

    await this.supervised.sendPrompt('Add reflection for completed aim using addReflection MCP tool.')
    await this.waitForIdle()

    // Compact
    await this.compactConversation()
  }
}
```

### Prompt Templates

```typescript
const SUPERVISOR_PROMPTS = {
  EXPLORING: (ctx: Context) => `
[STATE: EXPLORING]

Main session context:
${ctx.supervisedOutput.slice(-20).join('\n')}

Current project:
- Active phases: ${ctx.activePhases.join(', ')}
- Open aims: ${ctx.openAimsCount}
- Compute budget: ${ctx.computeCredits} credits

Available actions (respond with ONE as JSON):
{"action": "start_work", "aim_id": "uuid", "aim_text": "description", "strategy": "approach"}
{"action": "break_down", "aim_id": "uuid"}
{"action": "ideate", "type": "research|new_aims|improvements"}

Your JSON response:
`,

  WORKING: (ctx: Context) => `
[STATE: WORKING]

Working on: ${ctx.aimText}
Elapsed: ${ctx.workDuration}

Main session context:
${ctx.supervisedOutput.slice(-30).join('\n')}

Status: ${ctx.supervisedStatus}

Available actions (respond with ONE as JSON):
{"action": "proceed", "type": "motivate|option_select|none"}
{"action": "wrap_up", "summary": "what was accomplished"}

Your JSON response:
`,

  WRAPPING_UP: (ctx: Context) => `
[STATE: WRAPPING_UP]

Completed aim: ${ctx.aimText}

Main session context:
${ctx.supervisedOutput.slice(-50).join('\n')}

Question: Has ~80% of requirements been met? (Don't overengineer)

Available actions (respond with ONE as JSON):
{"action": "verify", "verdict": "complete", "notes": "looks good"}
{"action": "verify", "verdict": "incomplete", "notes": "missing X, Y, Z"}

Your JSON response:
`,

  ERROR: (ctx: Context) => `
[STATE: ERROR]

Error occurred: ${ctx.errorReason}
Retry count: ${ctx.errorCount}

Main session context:
${ctx.supervisedOutput.slice(-30).join('\n')}

Available actions (respond with ONE as JSON):
{"action": "retry", "from_state": "${ctx.previousState}"}
{"action": "reset", "to_state": "EXPLORING"}
{"action": "abort", "reason": "unrecoverable"}

Your JSON response:
`
}
```

---

## State Transition Table

| From State | Action | To State | Side Effects |
|------------|--------|----------|--------------|
| EXPLORING | start_work | WORKING | Send work prompt to supervised |
| EXPLORING | break_down | EXPLORING | Prompt supervised to create sub-aims |
| EXPLORING | ideate | EXPLORING | Prompt supervised for research/new aims |
| WORKING | proceed (motivate) | WORKING | Send motivational prompt |
| WORKING | proceed (option_select) | WORKING | Send option choice to supervised stdin |
| WORKING | proceed (none) | WORKING | No action, keep monitoring |
| WORKING | wrap_up | WRAPPING_UP | Prepare for verification |
| WRAPPING_UP | verify (complete) | EXPLORING | Verify + commit + reflect + compact |
| WRAPPING_UP | verify (incomplete) | WORKING | Send missing items to supervised |
| Any | timeout/error | ERROR | Start exponential backoff |
| ERROR | retry | Previous State | Attempt recovery |
| ERROR | reset | EXPLORING | Start fresh |
| ERROR | abort | EXPLORING | Log error, reset |

---

## Example Flow

### Successful Aim Completion

1. **EXPLORING**
   - Supervisor: `{"action": "start_work", "aim_id": "abc", "aim_text": "Add tests", "strategy": "Write unit tests for auth module"}`
   - Engine sends work prompt to supervised
   - → WORKING

2. **WORKING**
   - Supervised writes tests, runs them
   - Supervisor: `{"action": "proceed", "type": "none"}` (work continues)
   - Supervised finishes
   - Supervisor: `{"action": "wrap_up", "summary": "Tests written and passing"}`
   - → WRAPPING_UP

3. **WRAPPING_UP**
   - Supervisor: `{"action": "verify", "verdict": "complete", "notes": "Tests cover auth module, all passing"}`
   - Engine prompts supervised:
     - Verify aim context ✓
     - Git commit ✓
     - Add reflection ✓
   - Engine compacts conversation
   - → EXPLORING

4. **EXPLORING**
   - Loop continues...

### Handling User Input

1. **WORKING**
   - Supervised shows: `(A) Run tests now (B) Skip tests (C) Run specific test`
   - Supervisor sees options in context
   - Supervisor: `{"action": "proceed", "type": "option_select", "choice": "A", "reasoning": "Tests are important"}`
   - Engine sends "A" to supervised stdin
   - Work continues

### Error Recovery

1. **WORKING**
   - Supervised session hangs (no output for 5 minutes)
   - → ERROR

2. **ERROR** (retry 1, wait 1 minute)
   - Send health check to supervisor
   - Supervisor: `{"action": "retry", "from_state": "WORKING"}`
   - → WORKING

3. **ERROR** (retry 2, wait 2 minutes)
   - Still stuck
   - Supervisor: `{"action": "reset", "to_state": "EXPLORING"}`
   - → EXPLORING (fresh start)

---

## Implementation Checklist

- [ ] Create AnimatorState class (in-memory)
- [ ] Create supervisor prompt templates
- [ ] Implement state transition logic
- [ ] Implement executeAction for each action type
- [ ] Add user input detection and handling
- [ ] Implement ERROR state with exponential backoff
- [ ] Add compaction in WRAPPING_UP
- [ ] Add logging (state transitions, actions, decisions)
- [ ] Test with real aims
- [ ] Tune prompts and timing

---

## Next Steps

1. Create implementation aim for state machine
2. Start with EXPLORING → WORKING transition (simplest path)
3. Add WRAPPING_UP state
4. Add ERROR handling
5. Test full loop with real project
6. Iterate on prompts based on behavior

---

*This state machine provides structured autonomy while keeping user manual control always available.*
