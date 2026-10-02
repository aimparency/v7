# Animator State Machine

## Architecture Clarification

**Two Sessions:**
1. **Main Session (Worker)** - Claude/Gemini/Codex doing actual work
2. **Animator Session (Watchdog)** - Orchestrates the worker via state machine

**How It Works:**
- Animator maintains state machine
- Animator prompts itself with JSON format
- Animator decides when to send INSTRUCT.md or other prompts to main session
- Main session does the work, animator monitors and guides

---

## State Machine (3 States)

```
┌────────────┐
│  EXPLORING │ ←──────────────┐
└─────┬──────┘                │
      │                       │
      ↓                       │
┌────────────┐                │
│  WORKING   │                │
└─────┬──────┘                │
      │                       │
      ↓                       │
┌────────────┐                │
│ WRAPPING-UP│────────────────┘
└────────────┘
```

---

## State 1: EXPLORING

**Purpose:** Explore available work, break down ideas, ideate new possibilities

**Animator Prompt (to itself):**
```
[STATE: EXPLORING]

Current project context:
- Active phases: {phase_list}
- Open ideas: {count}
- Compute budget: {credits} credits, {funds} funds

Check what work is available and decide next action.

Available actions:
1. start_work: Begin working on specific idea
   → Transitions to WORKING
   → Provide: idea_id, idea_text, strategy

2. break_down_ideas: Decompose complex ideas into sub-ideas
   → Stays in EXPLORING
   → Provide: idea_id to decompose

3. ideate: Generate new ideas, research, formulate hypotheses
   → Stays in EXPLORING
   → Provide: ideation_type (research|new_ideas|improvements|hypothesis)

Respond with JSON:
{"action": "start_work", "idea_id": "...", "idea_text": "...", "strategy": "..."}
```

**Action Details:**

### start_work
- Animator calls MCP: `get_idea_context(idea_id)`
- Prepares context for main session
- Sends INSTRUCT.md + idea context to main session
- Transitions to WORKING state
- **Provide:** `idea_id`, `idea_text`, `strategy`

### break_down_ideas
- Animator prompts main session: "Break down this idea: {idea_text}. Create sub-ideas using create_idea MCP tool."
- Main session creates sub-ideas
- Stays in EXPLORING (loops back to check ideas again)
- **Provide:** `idea_id` to decompose

### ideate
- **research:** Prompt main session to do web research on topic
- **new_ideas:** "Look at codebase and create ideas for improvements (refactoring, tests, docs, security)"
- **improvements:** "Review recent work and suggest optimizations"
- **hypothesis:** "Formulate hypotheses about system behavior, create ideas to test them"
- Stays in EXPLORING
- **Provide:** `ideation_type`

**MCP Tools Used by Animator:**
- `list_phases` - get active phases
- `get_prioritized_ideas` - find work
- `list_phase_ideas_recursive` - check phase contents
- `get_idea_context` - understand idea before starting

---

## State 2: WORKING

**Purpose:** Push main session to complete the idea

**Animator Prompt (to itself):**
```
[STATE: WORKING]

Currently working on: {idea_text}
Strategy: {strategy}
Time elapsed: {duration}
Main session status: {idle|busy|waiting_for_input}

Main session is making progress on the idea.

Available actions:
1. proceed: Continue working
   → Stays in WORKING
   → Provide: prompt_type (motivate|option_select|none)

2. wrapping_up: Main session indicates work is done
   → Transitions to WRAPPING-UP
   → Provide: work_summary

Respond with JSON:
{"action": "proceed", "prompt_type": "motivate"}
```

**Action Details:**

### proceed
Main session continues working. Animator can optionally prompt:

- **motivate:** Send encouraging prompt to main session
  - "You're making good progress on {idea_text}. Keep going!"
  - "Tests are passing, implement the next piece"
  - Used when main session is idle but work not complete

- **option_select:** Main session waiting for user input
  - Detect when main session shows options (A/B/C)
  - Animator makes decision or escalates to human
  - Send selection to main session

- **none:** Just keep monitoring, don't interrupt
  - Main session busy, making progress
  - No intervention needed

**Provide:** `prompt_type` (motivate|option_select|none)

### wrapping_up
Main session signals work is complete:
- Detects phrases like "work is done", "idea completed", "ready to commit"
- OR idea status updated to "done" via MCP
- Transitions to WRAPPING-UP
- **Provide:** `work_summary`

**Handling User Interaction:**

When main session needs input:
1. **Detect:** Look for patterns like "(A) option1 (B) option2 [Your choice:]"
2. **Decide:**
   - Simple choices: Animator makes decision based on context
   - Critical choices: Animator pauses, requests human input, waits
3. **Send:** Input to main session stdin
4. **Continue:** Resume work

---

## State 3: WRAPPING-UP

**Purpose:** Verify completion, commit changes, compact context

**Animator Prompt (to itself):**
```
[STATE: WRAPPING-UP]

Idea completed: {idea_text}
Work summary: {work_summary}

Verify the idea is truly complete without overengineering.

Available actions:
1. verify_and_commit: Check idea context, verify done, commit, compact
   → Transitions to EXPLORING
   → Provide: verification_notes

2. incomplete: Work not actually done
   → Transitions back to WORKING
   → Provide: missing_items

Respond with JSON:
{"action": "verify_and_commit", "verification_notes": "..."}
```

**Action Details:**

### verify_and_commit

**Verification Steps:**
1. Call MCP: `get_idea_context(idea_id)` to refresh context
2. Check if idea criteria met (don't overthink, basic sanity check)
3. Verify no obvious errors or failures
4. Update idea status to "done" via `update_idea`

**Commit Steps:**
1. Prompt main session: "Track changes and create git commit for completed work. Use `git add -u` then `git add` for new files, then commit."
2. Wait for commit completion
3. Verify commit succeeded

**Compact Steps:**
1. Similar to current implementation
2. Compact conversation history
3. Clean up context

**Then:**
- Transition to EXPLORING
- Loop continues

**Provide:** `verification_notes` (what was verified)

### incomplete
- Work review shows idea not actually done
- Missing pieces identified
- Transition back to WORKING
- **Provide:** `missing_items` (what's not complete)

---

## State Transition Rules

| Current State | Action | Next State |
|--------------|--------|------------|
| EXPLORING | start_work | WORKING |
| EXPLORING | break_down_ideas | EXPLORING |
| EXPLORING | ideate | EXPLORING |
| WORKING | proceed | WORKING |
| WORKING | wrapping_up | WRAPPING-UP |
| WRAPPING-UP | verify_and_commit | EXPLORING |
| WRAPPING-UP | incomplete | WORKING |

---

## Animator Implementation

### Core Loop

```typescript
class AnimatorStateMachine {
  currentState: 'EXPLORING' | 'WORKING' | 'WRAPPING-UP' = 'EXPLORING'
  context: StateContext

  async tick() {
    // 1. Check if main session is idle/busy/waiting
    const mainSessionStatus = await this.checkMainSession()

    // 2. Generate prompt for current state
    const prompt = this.generatePrompt(this.currentState, mainSessionStatus)

    // 3. Send prompt to animator session (itself)
    const response = await this.animatorSession.sendPrompt(prompt)

    // 4. Parse JSON action
    const action = this.parseAction(response)

    // 5. Validate action is valid for current state
    if (!this.isValidAction(this.currentState, action)) {
      console.error('Invalid action for state')
      return
    }

    // 6. Execute action (might prompt main session)
    await this.executeAction(action)

    // 7. Transition to next state
    this.currentState = this.getNextState(this.currentState, action)

    // 8. Log transition
    this.logTransition(action)
  }

  async executeAction(action: Action) {
    switch(action.action) {
      case 'start_work':
        await this.startWork(action.idea_id, action.strategy)
        break
      case 'break_down_ideas':
        await this.breakDownAim(action.idea_id)
        break
      case 'ideate':
        await this.ideate(action.ideation_type)
        break
      case 'proceed':
        await this.proceedWork(action.prompt_type)
        break
      case 'wrapping_up':
        // Just transition, no immediate action
        break
      case 'verify_and_commit':
        await this.verifyAndCommit(action.verification_notes)
        break
      case 'incomplete':
        await this.handleIncomplete(action.missing_items)
        break
    }
  }

  async startWork(ideaId: string, strategy: string) {
    // Get idea context from MCP
    const ideaContext = await mcp.get_idea_context(ideaId)

    // Send INSTRUCT.md + idea context to main session
    const prompt = `${INSTRUCT_TEXT}\n\nWork on this idea:\n${ideaContext}\n\nStrategy: ${strategy}`
    await this.mainSession.sendPrompt(prompt)
  }

  async proceedWork(promptType: 'motivate' | 'option_select' | 'none') {
    if (promptType === 'motivate') {
      await this.mainSession.sendPrompt(`Keep making progress on ${this.context.ideaText}`)
    } else if (promptType === 'option_select') {
      // Detect options in main session output
      const choice = await this.makeChoice() // or escalate to human
      await this.mainSession.sendInput(choice)
    }
    // 'none' = no action
  }
}
```

### Prompt Templates

```typescript
const PROMPTS = {
  EXPLORING: (context: StateContext) => `
[STATE: EXPLORING]

Current project context:
- Active phases: ${context.activePhases}
- Open ideas: ${context.openAimsCount}
- Compute budget: ${context.computeCredits} credits

Available actions:
1. start_work: Begin working on specific idea (provide idea_id, idea_text, strategy)
2. break_down_ideas: Decompose complex ideas (provide idea_id)
3. ideate: Generate new ideas/research (provide ideation_type: research|new_ideas|improvements|hypothesis)

Respond with JSON:
{"action": "start_work", "idea_id": "...", "idea_text": "...", "strategy": "..."}
`,

  WORKING: (context: StateContext) => `
[STATE: WORKING]

Working on: ${context.ideaText}
Time elapsed: ${context.workDuration}
Main session: ${context.mainSessionStatus}

Available actions:
1. proceed: Continue working (provide prompt_type: motivate|option_select|none)
2. wrapping_up: Work is done (provide work_summary)

Respond with JSON:
{"action": "proceed", "prompt_type": "motivate"}
`,

  WRAPPING_UP: (context: StateContext) => `
[STATE: WRAPPING-UP]

Completed idea: ${context.ideaText}
Summary: ${context.workSummary}

Verify completion and commit changes.

Available actions:
1. verify_and_commit: Check done, commit, compact (provide verification_notes)
2. incomplete: Not actually done (provide missing_items)

Respond with JSON:
{"action": "verify_and_commit", "verification_notes": "..."}
`
}
```

---

## Handling Human Interaction

### Detection Patterns

```typescript
function detectUserInputNeeded(output: string): boolean {
  // Detect option prompts
  if (/\([A-Z]\).*\([A-Z]\)/.test(output)) return true

  // Detect "press key to continue"
  if (/press.*key|continue\?/i.test(output)) return true

  // Detect yes/no prompts
  if (/\(y\/n\)/i.test(output)) return true

  return false
}

function extractOptions(output: string): Option[] {
  // Parse "(A) option1 (B) option2" format
  const matches = output.matchAll(/\(([A-Z])\)\s*([^\(]+)/g)
  return Array.from(matches).map(m => ({
    key: m[1],
    text: m[2].trim()
  }))
}
```

### Decision Making

```typescript
async function handleUserInput(options: Option[]): Promise<string> {
  // Simple heuristics for common cases
  if (isTestRelated(options)) {
    return chooseRunTests(options)
  }

  if (isSafetyChoice(options)) {
    return chooseSafeOption(options)
  }

  // Ask animator LLM to decide
  const decision = await animator.makeDecision(options, context)

  // If critical decision, escalate to human
  if (isCritical(decision)) {
    return await askHuman(options)
  }

  return decision
}
```

---

## Open Questions Before Implementation

### 1. **Animator Session Type**
**Question:** Should the animator be a separate LLM session, or built into the watchdog process?

**Options:**
- **Separate session:** Animator is its own Claude/Gemini session that gets JSON prompts
- **Built-in logic:** Watchdog has hardcoded decision logic, no LLM for animator

**Recommendation:** Start with separate session for flexibility, can optimize later

---

### 2. **Main Session Prompting Strategy**
**Question:** When do we send INSTRUCT.md vs minimal prompts to main session?

**Options:**
- **Always send INSTRUCT.md:** Every work session starts with full instructions
- **Send once per session:** INSTRUCT.md on first work, then minimal prompts
- **Context-aware:** Send INSTRUCT.md only when needed

**Recommendation:** Send INSTRUCT.md when transitioning to WORKING (start_work action)

---

### 3. **State Persistence**
**Question:** Where do we store current state between restarts?

**Options:**
- **In-memory only:** State lost on restart
- **.bowman/animator-state.json:** Persist state file
- **Runtime metadata:** Use existing watchdog runtime state

**Recommendation:** Use `.bowman/animator-state.json` for persistence

```json
{
  "currentState": "WORKING",
  "stateEnteredAt": "2026-03-29T10:00:00Z",
  "context": {
    "ideaId": "uuid",
    "ideaText": "...",
    "strategy": "..."
  },
  "history": [...]
}
```

---

### 4. **Human Escalation**
**Question:** How does human override work?

**Options:**
- **Emergency stop only:** Human can stop but not interact mid-work
- **Full takeover:** Human can pause, provide input, resume
- **Advisory mode:** Animator asks human for critical decisions

**Recommendation:** Start with emergency stop + advisory mode for critical choices

---

### 5. **Compact Timing**
**Question:** When do we compact conversation history?

**Current:** `compactEvery` parameter (e.g., every 1 turn)

**Options:**
- **Keep current:** Compact after each idea (in WRAPPING-UP)
- **Configurable:** User sets compact frequency
- **Budget-based:** Compact when token budget low

**Recommendation:** Keep current behavior - compact in WRAPPING-UP state

---

### 6. **Multi-Idea Work**
**Question:** Can animator work on multiple ideas in parallel?

**Options:**
- **Single-idea:** One idea at a time (simpler)
- **Multi-idea:** Queue multiple ideas, work in parallel sessions

**Recommendation:** Start single-idea, extend to multi-idea later

---

### 7. **Ideation Scope**
**Question:** How aggressive should ideation be?

**Options:**
- **Conservative:** Only create ideas when explicitly needed
- **Moderate:** Suggest improvements during EXPLORING
- **Aggressive:** Constantly generate new ideas for everything

**Recommendation:** Moderate - suggest improvements but don't spam idea graph

---

### 8. **Verification Depth**
**Question:** How thorough should WRAPPING-UP verification be?

**Guidance:** "without overengineering"

**Options:**
- **Minimal:** Just check idea context, mark done
- **Basic:** Check context + run tests if test idea
- **Thorough:** Check context + tests + manual review

**Recommendation:** Basic - check context, run tests if applicable, don't overthink

---

### 9. **Action Validation**
**Question:** What happens if animator returns invalid action?

**Options:**
- **Retry:** Re-prompt with error message
- **Default action:** Fall back to safe default (e.g., "proceed none")
- **Emergency stop:** Stop and alert human

**Recommendation:** Retry once, then default to safe action, log error

---

### 10. **Logging & Observability**
**Question:** What gets logged to agent_log.json?

**Should include:**
- State transitions
- Actions taken
- Prompts sent to main session
- MCP tool calls
- Decision reasoning
- Errors/retries

**Format:**
```json
{
  "session_id": "...",
  "state_transitions": [...],
  "actions": [...],
  "prompts_to_main": [...],
  "mcp_calls": [...],
  "errors": [...]
}
```

---

## Implementation Checklist

Before starting implementation, confirm:

- [ ] **Animator session type** - Separate LLM session or built-in?
- [ ] **State persistence** - Where to store state?
- [ ] **Human escalation** - How does takeover work?
- [ ] **Main session prompting** - When to send INSTRUCT.md?
- [ ] **Verification depth** - How thorough in WRAPPING-UP?
- [ ] **Compact timing** - When to compact?
- [ ] **Logging format** - What to log in agent_log.json?
- [ ] **Action validation** - How to handle invalid actions?

---

## Next Steps

1. **Answer open questions** (above)
2. **Create idea** for state machine implementation
3. **Prototype** EXPLORING state first
4. **Test** with real ideas
5. **Iterate** on WORKING and WRAPPING-UP states
6. **Add** logging and observability
7. **Tune** prompts and timing

---

*This state machine transforms the current "send INSTRUCT.md and hope" approach into a structured, observable, and controllable autonomy loop.*
