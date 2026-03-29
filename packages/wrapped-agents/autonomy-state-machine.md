# Autonomy State Machine

A tidy state machine for autonomous agent operation across all session types (Claude, Gemini, Codex).

## Design Philosophy

- **Minimal hardcoded logic** - LLM makes decisions, state machine provides structure
- **JSON action responses** - Agent responds with `{"action": "...", ...}` for state transitions
- **Universal** - Same state machine across all agent types
- **Information streams** - Agent subscribes to RSS/feeds for context beyond aim graph
- **Observable** - Each state transition logged to agent_log.json

---

## State Machine

```
┌──────────────┐
│   IDLE       │ ←─────────────────────┐
└──────┬───────┘                       │
       │                               │
       ↓                               │
┌──────────────┐                       │
│ DISCOVERING  │                       │
└──────┬───────┘                       │
       │                               │
       ↓                               │
┌──────────────┐                       │
│  PLANNING    │                       │
└──────┬───────┘                       │
       │                               │
       ↓                               │
┌──────────────┐                       │
│  EXECUTING   │ ←──────┐              │
└──────┬───────┘        │              │
       │                │              │
       ↓                │ (retry)      │
┌──────────────┐        │              │
│  VERIFYING   │────────┘              │
└──────┬───────┘                       │
       │                               │
       ↓                               │
┌──────────────┐                       │
│  REFLECTING  │───────────────────────┘
└──────────────┘
```

---

## States

### IDLE
**Purpose:** Waiting state - no active work

**Prompt:**
```
You are in IDLE state. No active work.

Available actions:
- discover: Start looking for work
- wait: Stay idle (provide reason)
```

**Valid Actions:**
- `{"action": "discover"}` → DISCOVERING
- `{"action": "wait", "reason": "..."}` → IDLE (stay)

**When to use:** System just started, or completed all work

---

### DISCOVERING
**Purpose:** Find work to do from multiple sources

**Prompt:**
```
You are in DISCOVERING state. Find work from these sources:

1. **Aim Graph**: Check prioritized aims, active phases
2. **Information Streams**: Check RSS feeds, GitHub issues, docs updates
3. **System Needs**: Check for gaps (tests, docs, refactoring, security)

Use MCP tools:
- get_prioritized_aims
- list_phases / list_phase_aims_recursive
- (future: check_rss_feeds, check_github_issues)

Available actions:
- found_work: Transition to planning (provide aim_id or work description)
- no_work: Nothing to do (provide reason)
- subscribe: Subscribe to new information source
```

**Valid Actions:**
- `{"action": "found_work", "work_type": "aim|rss|system", "aim_id": "...", "description": "..."}` → PLANNING
- `{"action": "no_work", "reason": "..."}` → IDLE
- `{"action": "subscribe", "feed_url": "...", "feed_type": "rss|github|docs"}` → DISCOVERING (stay, register subscription)

**Information Streams to Support:**
- RSS feeds (blogs, docs, release notes)
- GitHub issue tracking
- Documentation change feeds
- System health metrics
- Compute budget status

---

### PLANNING
**Purpose:** Break down work, create sub-aims, formulate strategy

**Prompt:**
```
You are in PLANNING state for work: {work_description}

Your task:
1. Understand the aim using get_aim_context
2. Break down if complex (create sub-aims)
3. Identify required tools and steps
4. Assess complexity and risks

Available actions:
- create_sub_aim: Break work into smaller piece
- ready: Plan complete, ready to execute
- blocked: Cannot proceed (provide reason)
```

**Valid Actions:**
- `{"action": "create_sub_aim", "text": "...", "description": "..."}` → PLANNING (stay, create aim)
- `{"action": "ready", "strategy": "...", "tools": ["..."]}` → EXECUTING
- `{"action": "blocked", "reason": "...", "escalate": true|false}` → REFLECTING

**Guardrails:**
- Check compute budget before committing to work
- Estimate cost/complexity
- Identify safety concerns

---

### EXECUTING
**Purpose:** Do the actual work using tools

**Prompt:**
```
You are in EXECUTING state for: {work_description}

Strategy: {planned_strategy}
Tools available: {tool_list}

Do the work:
- Write code, create files, run commands
- Use available tools (git, npm, file ops, APIs, etc.)
- Track progress against plan

Available actions:
- continue: Keep working (provide progress update)
- complete: Work finished
- failed: Work failed (provide reason)
- needs_help: Blocked or uncertain
```

**Valid Actions:**
- `{"action": "continue", "progress": "...", "tools_used": ["..."]}` → EXECUTING (stay)
- `{"action": "complete", "summary": "..."}` → VERIFYING
- `{"action": "failed", "reason": "...", "recoverable": true|false}` → VERIFYING
- `{"action": "needs_help", "question": "..."}` → REFLECTING (escalate to human)

**Logging:**
- Every tool use logged
- Decisions logged
- Progress tracked

---

### VERIFYING
**Purpose:** Confirm work succeeded, check for errors

**Prompt:**
```
You are in VERIFYING state. You just completed: {work_summary}

Verify the work:
1. Run tests if applicable
2. Check if aim criteria met
3. Look for errors or warnings
4. Validate output quality

Available actions:
- success: Work verified successful
- partial: Partially successful (provide what's missing)
- failed: Verification failed (provide reason)
- retry: Try executing again with modifications
```

**Valid Actions:**
- `{"action": "success", "evidence": "..."}` → REFLECTING
- `{"action": "partial", "completed": "...", "missing": "..."}` → REFLECTING
- `{"action": "failed", "reason": "...", "retry_strategy": "..."}` → EXECUTING (if retry) or REFLECTING
- `{"action": "retry", "modifications": "..."}` → EXECUTING

**Verification Methods:**
- Run test suite
- Check build passes
- Validate file created
- Confirm API response
- Human review for critical changes

---

### REFLECTING
**Purpose:** Learn from work, build institutional memory, identify limitations

**Prompt:**
```
You are in REFLECTING state. Work completed: {work_summary}

Reflect on what happened:
1. What worked well?
2. What failed or was difficult?
3. What system limitations did you encounter?
4. What would you improve?
5. Any patterns to remember?

Use addReflection MCP tool with structured format.

Available actions:
- add_reflection: Record reflection (required)
- identify_limitation: Discovered system limitation
- create_improvement_aim: Create aim to address limitation
- continue: Reflection complete, ready for next work
```

**Valid Actions:**
- `{"action": "add_reflection", "aimId": "...", "reflection": {...}}` → REFLECTING (stay until reflection added)
- `{"action": "identify_limitation", "limitation": "...", "severity": "low|medium|high"}` → REFLECTING (log limitation)
- `{"action": "create_improvement_aim", "text": "...", "addresses_limitation": "..."}` → REFLECTING (create meta-aim)
- `{"action": "continue"}` → DISCOVERING

**Reflection Structure:**
```json
{
  "context": "What were you trying to achieve?",
  "outcome": "What actually happened?",
  "effectiveness": "How well did your approach work?",
  "lesson": "What would you do differently next time?",
  "pattern": "Does this relate to past experiences?"
}
```

**Self-Improvement:**
This is where **recursive self-improvement** happens:
- Agent identifies own limitations
- Creates aims to address those limitations
- Builds pattern library over time
- Learns from past mistakes

---

## State Machine Implementation

### Core Structure

```typescript
interface State {
  name: string
  prompt: (context: StateContext) => string
  validActions: ActionDefinition[]
  onEnter?: (context: StateContext) => void
  onExit?: (context: StateContext) => void
}

interface ActionDefinition {
  name: string
  parameters: Record<string, any>
  nextState: string | ((context: StateContext) => string)
  execute?: (params: any, context: StateContext) => Promise<void>
}

interface StateContext {
  currentState: string
  workDescription?: string
  aimId?: string
  strategy?: string
  history: StateTransition[]
  metadata: Record<string, any>
}

interface StateTransition {
  from: string
  to: string
  action: string
  timestamp: number
  data: any
}
```

### Watchdog Behavior

1. **Idle Detection:** When worker is idle, check current state
2. **Prompt Generation:** Generate prompt for current state + valid actions
3. **Send to Agent:** Post prompt to worker
4. **Parse Response:** Extract JSON action from response
5. **Validate:** Check action is valid for current state
6. **Execute:** Run any action-specific logic (e.g., create_sub_aim calls MCP)
7. **Transition:** Move to next state
8. **Log:** Record transition to agent_log.json
9. **Repeat:** Wait for idle, continue loop

### Prompt Format

```
[STATE: {state_name}]

{state_specific_prompt}

{context_information}

Available actions:
{action_list_with_parameters}

Respond ONLY with raw JSON action object:
{"action": "action_name", "param1": "value", ...}
```

### Error Handling

- **Invalid action:** Stay in current state, prompt again with error message
- **Parse error:** Retry with clarification
- **Tool failure:** Log, allow agent to decide (retry/fail/escalate)
- **Stuck detection:** If in same state too long, escalate or force transition to REFLECTING

---

## Information Streams (RSS/Feeds)

### Subscription Management

```json
// .bowman/subscriptions.json
{
  "feeds": [
    {
      "id": "uuid",
      "type": "rss",
      "url": "https://blog.example.com/feed.xml",
      "tags": ["docs", "api"],
      "check_frequency": "daily",
      "last_checked": "2026-03-29T10:00:00Z"
    },
    {
      "id": "uuid",
      "type": "github",
      "repo": "owner/repo",
      "resource": "issues",
      "filter": "label:enhancement",
      "check_frequency": "hourly"
    }
  ]
}
```

### Discovery from Feeds

During DISCOVERING state:
1. Check subscribed feeds for new items
2. Generate aims from feed items if relevant
3. Prioritize based on tags/relevance
4. Example: New GitHub issue → create corresponding aim

**Feed Types:**
- **RSS/Atom** - Blog posts, docs updates, release notes
- **GitHub** - Issues, PRs, releases, discussions
- **Documentation** - API doc changes, new guides
- **System Metrics** - Compute budget, error rates, performance
- **Human Input** - Email, chat, tickets (future)

---

## Agent Manifest (agent.json)

```json
{
  "name": "Bowman",
  "version": "7.0.0",
  "agent_type": "autonomous",
  "operator_wallet": "0x...",
  "erc8004_identity": "0x...",

  "state_machine": {
    "current_state": "IDLE",
    "states": ["IDLE", "DISCOVERING", "PLANNING", "EXECUTING", "VERIFYING", "REFLECTING"],
    "loop_version": "1.0.0"
  },

  "capabilities": {
    "tools": ["git", "npm", "file_ops", "code_generation", "api_calls", "test_execution"],
    "tech_stacks": ["node.js", "typescript", "vue", "python"],
    "task_categories": ["project_management", "code_generation", "testing", "documentation"]
  },

  "constraints": {
    "max_api_calls_per_hour": 1000,
    "max_compute_credits": 10000,
    "safe_operations_only": true
  },

  "subscriptions": {
    "rss_feeds": 3,
    "github_repos": 1,
    "doc_sources": 2
  },

  "learning": {
    "total_reflections": 47,
    "identified_limitations": 12,
    "improvement_aims_created": 8,
    "pattern_library_size": 23
  }
}
```

---

## Execution Logs (agent_log.json)

```json
{
  "session_id": "uuid",
  "agent_id": "0x...",
  "start_time": "2026-03-29T10:00:00Z",
  "end_time": null,

  "state_transitions": [
    {
      "from": "IDLE",
      "to": "DISCOVERING",
      "action": "discover",
      "timestamp": "2026-03-29T10:00:05Z"
    },
    {
      "from": "DISCOVERING",
      "to": "PLANNING",
      "action": "found_work",
      "data": {
        "work_type": "aim",
        "aim_id": "uuid",
        "description": "Implement autonomous loop"
      },
      "timestamp": "2026-03-29T10:01:23Z"
    }
  ],

  "decisions": [
    {
      "state": "DISCOVERING",
      "timestamp": "2026-03-29T10:00:45Z",
      "context": "Checked prioritized aims",
      "reasoning": "Found high-priority aim in active phase",
      "action": "found_work"
    }
  ],

  "tool_calls": [
    {
      "tool": "get_prioritized_aims",
      "timestamp": "2026-03-29T10:00:30Z",
      "parameters": {"limit": 10},
      "result": "success",
      "duration_ms": 234
    }
  ],

  "reflections": [
    {
      "aim_id": "uuid",
      "timestamp": "2026-03-29T10:15:00Z",
      "reflection": {...}
    }
  ],

  "limitations_identified": [
    {
      "timestamp": "2026-03-29T10:10:00Z",
      "limitation": "Cannot parse unstructured user feedback",
      "severity": "medium",
      "created_improvement_aim": "uuid"
    }
  ],

  "failures": [
    {
      "timestamp": "2026-03-29T10:12:00Z",
      "state": "EXECUTING",
      "error": "Test failed",
      "recovery": "retried with modifications"
    }
  ]
}
```

---

## Benefits of This Approach

1. **Structured Autonomy** - Clear states, not a black box
2. **Observable** - Every decision logged and explainable
3. **Flexible** - LLM makes decisions within structure
4. **Universal** - Same for Claude/Gemini/Codex
5. **Extensible** - Easy to add new states/actions
6. **Self-Improving** - REFLECTING state enables learning
7. **Information-Rich** - RSS feeds provide context beyond code
8. **Minimal Hardcoding** - States defined declaratively
9. **Meets Challenge Requirements** - discover→plan→execute→verify→reflect formalized

---

## Implementation Path

1. **Phase 1:** Define state machine structure (TypeScript types)
2. **Phase 2:** Implement state manager in watchdog
3. **Phase 3:** Create prompt templates for each state
4. **Phase 4:** Add agent_log.json generation
5. **Phase 5:** Implement RSS/feed subscription system
6. **Phase 6:** Add self-improvement logic (limitation tracking → improvement aims)
7. **Phase 7:** Generate agent.json manifest
8. **Phase 8:** Add ERC-8004 identity integration

---

*This state machine transforms Aimparency from "instruction-following agent" to "autonomous agent with observable decision loops and recursive self-improvement."*
