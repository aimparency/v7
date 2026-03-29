# Current INSTRUCT.md State Analysis

## Problem: ALL States in ONE Prompt

Currently, INSTRUCT.md tries to handle **every state at once** in a single massive prompt:

### States Currently Embedded Together:

**DISCOVERING (lines 13-21):**
```
When idle or unsure what to do:
1. Check active phases
2. Find open work
3. Pick an aim
```

**PLANNING (line 22 + 27):**
```
4. Work on it
...
7. Break down if needed: create sub-aims
```

**EXECUTING (line 19):**
```
4. Work on it: Implement the aim - write code, create files, run tests
```

**VERIFYING (line 20):**
```
5. Update status: mark as done when complete, or add comment if blocked
```

**REFLECTING (lines 21, 49-76):**
```
6. Reflect on completion: use addReflection
...
[Entire reflection pattern section]
```

**META/PROACTIVE (lines 23-35):**
```
Go Beyond the Graph:
- Do web research
- Create your own aims
- Refactoring, testing, documentation, security, performance
```

**STOP CONDITIONS (lines 86-94):**
```
Only consider stopping if:
- ALL aims done
- Nothing more to do
```

---

## Current Behavior

**Watchdog posts entire INSTRUCT.md when worker is idle**

Agent receives ~95 lines covering:
- Discovery instructions
- Planning instructions
- Execution instructions
- Verification instructions
- Reflection instructions
- Tool documentation
- Meta-guidance on being proactive
- Stop conditions
- Everything all at once

**Agent must:**
- Parse the whole thing
- Figure out which part is relevant
- Decide what state it's in implicitly
- Take action based on implicit understanding

---

## With State Machine

### IDLE → DISCOVERING Transition

**Before (current):**
```
[95 lines of INSTRUCT.md covering everything]
```

**After (state machine):**
```
[STATE: DISCOVERING]

You are looking for work. Check these sources:

1. Prioritized aims: get_prioritized_aims
2. Active phases: list_phases, list_phase_aims_recursive
3. System needs: tests, docs, refactoring, security

Available actions:
- found_work: Found something to do (provide aim_id or description)
- no_work: Nothing available (provide reason)

Respond with JSON:
{"action": "found_work", "aim_id": "...", "description": "..."}
```

**Reduction:** ~95 lines → ~15 lines
**Clarity:** Only what's needed for THIS state
**Structure:** Clear valid actions, JSON format

---

### PLANNING State

**Before (mixed into INSTRUCT.md):**
```
[Somewhere in the 95 lines:]
7. Break down if needed: If an aim is too large, create sub-aims
...
Before starting work on an aim, use get_aim_context
```

**After (state machine):**
```
[STATE: PLANNING]

Plan work for: {aim_text}

Steps:
1. Get context: get_aim_context("{aim_id}")
2. Understand parent aims if needed
3. Break into sub-aims if complex: create_aim with supportedAims
4. Assess tools needed

Available actions:
- create_sub_aim: Break into smaller piece (provide text, description)
- ready: Plan complete, ready to execute (provide strategy)
- blocked: Cannot proceed (provide reason)

Respond with JSON:
{"action": "ready", "strategy": "...", "tools": ["git", "npm"]}
```

**Reduction:** Implicit guidance → ~15 lines
**Clarity:** Specific to planning phase
**Structure:** Clear decision points

---

### EXECUTING State

**Before (mixed into INSTRUCT.md):**
```
[Somewhere in the 95 lines:]
4. Work on it: Implement the aim - write code, create files, run tests
```

**After (state machine):**
```
[STATE: EXECUTING]

Execute: {aim_text}
Strategy: {planned_strategy}
Tools: {tool_list}

Do the work using available tools.

Available actions:
- continue: Keep working (provide progress)
- complete: Work finished (provide summary)
- failed: Work failed (provide reason)
- needs_help: Blocked or uncertain (provide question)

Respond with JSON:
{"action": "complete", "summary": "Implemented feature X, tests passing"}
```

**Reduction:** 1 line of guidance → ~15 focused lines
**Clarity:** Just execute, clear completion criteria
**Structure:** Simple status updates

---

### VERIFYING State

**Before (mixed into INSTRUCT.md):**
```
[Somewhere in the 95 lines:]
5. Update status: mark as done when complete, or add comment if blocked
```

**After (state machine):**
```
[STATE: VERIFYING]

Verify work: {work_summary}

Check:
1. Run tests if applicable
2. Confirm aim criteria met
3. Look for errors or warnings
4. Validate output quality

Available actions:
- success: Work verified (provide evidence)
- partial: Partially done (provide what's complete, what's missing)
- failed: Verification failed (provide reason)
- retry: Try again with modifications (provide strategy)

Respond with JSON:
{"action": "success", "evidence": "All tests passing, feature working"}
```

**Reduction:** Implicit → ~18 lines
**Clarity:** Explicit verification checklist
**Structure:** Clear pass/fail/retry logic

---

### REFLECTING State

**Before (in INSTRUCT.md):**
```
[Lines 21, 47-76: ~30 lines about reflection]

## Reflection Pattern: Learn from Your Work

When to reflect:
- After completing each aim (immediate)
- End of each work session (periodic)
- When you encounter challenges or blockers

How to reflect:
[Full reflection structure with examples]

Benefits:
[List of benefits]
```

**After (state machine):**
```
[STATE: REFLECTING]

Work completed: {work_summary}
Result: {success|partial|failed}

Reflect on:
1. What worked well?
2. What was difficult?
3. System limitations encountered?
4. What to improve?
5. Patterns to remember?

Required:
- add_reflection: Record structured reflection (context, outcome, effectiveness, lesson, pattern)

Optional:
- identify_limitation: Found system weakness (provide description, severity)
- create_improvement_aim: Create aim to fix limitation

Available actions:
- add_reflection: Use addReflection MCP tool (provide aimId, reflection object)
- identify_limitation: Log limitation (provide description, severity)
- create_improvement_aim: Create meta-aim (provide text, addresses)
- continue: Reflection complete, ready for next work

Respond with JSON:
{"action": "add_reflection", "aimId": "...", "reflection": {...}}
```

**Reduction:** 30 lines → ~25 lines (similar length but more structured)
**Clarity:** Required vs optional actions clear
**Structure:** Self-improvement loop explicit

---

## Summary: Prompt Reduction

| State | Before (INSTRUCT.md) | After (State Machine) | Reduction |
|-------|---------------------|----------------------|-----------|
| ALL | 95 lines (everything) | N/A | N/A |
| DISCOVERING | Mixed in 95 | ~15 lines | **84% reduction** |
| PLANNING | Mixed in 95 | ~15 lines | **84% reduction** |
| EXECUTING | Mixed in 95 | ~15 lines | **84% reduction** |
| VERIFYING | Mixed in 95 | ~18 lines | **81% reduction** |
| REFLECTING | Mixed in 95 | ~25 lines | **74% reduction** |

---

## Benefits

**Cognitive Load:**
- Before: Parse 95 lines, figure out which applies
- After: Parse ~15-25 lines, all relevant

**Token Usage:**
- Before: ~1500 tokens per prompt
- After: ~250-500 tokens per prompt
- **Savings: 67-83% per prompt**

**Clarity:**
- Before: "What should I do?" hidden in instructions
- After: "These are your valid actions" explicit

**Observability:**
- Before: Agent implicitly in some state
- After: Agent explicitly in tracked state

**Error Reduction:**
- Before: Agent might skip steps (no enforcement)
- After: Agent must follow state transitions

---

## Implementation Strategy

1. **Extract state-specific prompts** from INSTRUCT.md
2. **Create prompt templates** for each state
3. **Define valid actions** per state
4. **Implement state tracker** in watchdog
5. **Generate prompts** dynamically based on current state
6. **Validate actions** before transitions
7. **Log everything** to agent_log.json

---

## Current State Implicit Logic

Looking at watchdog.ts behavior:
- Posts INSTRUCT_TEXT when worker is idle
- No explicit state tracking
- Agent decides everything implicitly
- All guidance front-loaded

**This is actually closest to:** DISCOVERING state (looking for work)

But the prompt tries to cover ALL states just in case the agent needs them.

With state machine: **only send what's needed now**, track state explicitly, validate transitions.

---

*The state machine transforms a 95-line "figure it out yourself" prompt into 5-6 focused 15-25 line "here's what you can do right now" prompts.*
