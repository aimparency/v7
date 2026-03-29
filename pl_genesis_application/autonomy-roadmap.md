# Aimparency Autonomy Roadmap
## Using Agent Only Challenge as ASI Development Framework

This document maps the PL_Genesis "Agent Only: Let the Agent Cook" challenge requirements to Aimparency's development aims, treating the challenge as a north star for achieving autonomous superintelligence through systematic capability development.

## Philosophy

Rather than building a hackathon demo, we're using industry-standard autonomy requirements as architectural guidance for transforming Aimparency/Bowman into a truly autonomous agent system. The challenge criteria become our development roadmap.

---

## Aim Hierarchy

### 🎯 North Star Aim
**ID:** `2b76f62f-3f7b-42f0-ab2e-b571dabf2ca5`
**Aim:** Achieve full autonomous agent capability: discover→plan→execute→verify→submit loop

This is the ultimate goal - an agent that operates end-to-end without human intervention, demonstrating true autonomy rather than scripted behavior.

---

## Core Required Capabilities (7 aims)

### 1. ⚙️ Autonomous Execution Loop (35% of judging)
**ID:** `0622adb1-e79d-483c-b894-199d92ca199d`
**Requirement:** Discover → plan → execute → verify → submit
**Current State:** Bowman can execute when prompted, but lacks autonomous discovery and continuous loop
**Gap:** Need self-directed problem discovery, automatic task decomposition, and self-correction
**Priority:** HIGHEST - this is the core capability

**What Success Looks Like:**
- Agent discovers aims that need work (from phases, dependencies, priorities)
- Automatically decomposes complex aims into sub-aims
- Executes without waiting for human prompts
- Verifies outcomes and self-corrects on errors
- Updates status and moves to next aim

---

### 2. 🆔 Agent Identity (ERC-8004)
**ID:** `1fd5ede2-5d81-4f38-8645-924887ab48ef`
**Requirement:** Unique onchain identity with operator wallet
**Current State:** No blockchain identity
**Gap:** Need ERC-8004 registration, operator wallet, identity management
**Priority:** HIGH - required for submission

**Implementation:**
- Create operator wallet (or use existing)
- Register Bowman agent on ERC-8004 registry
- Store identity in agent.json
- Reference in all agent operations

---

### 3. 📋 Capability Manifest
**ID:** `5cc73338-d648-4440-98ef-035217d06fcd`
**Requirement:** Machine-readable agent.json declaring capabilities
**Current State:** Capabilities are implicit in code
**Gap:** Need standardized manifest format
**Priority:** MEDIUM - required for submission

**agent.json Structure:**
```json
{
  "name": "Bowman",
  "version": "7.0.0",
  "operator_wallet": "0x...",
  "erc8004_identity": "0x...",
  "supported_tools": [
    "git", "npm", "file_operations", "code_generation",
    "api_calls", "test_execution", "deployment"
  ],
  "supported_stacks": ["node.js", "typescript", "vue", "python"],
  "compute_constraints": {
    "max_api_calls_per_hour": 1000,
    "max_compute_credits": 10000
  },
  "task_categories": [
    "project_management", "code_generation", "testing",
    "documentation", "deployment", "aim_decomposition"
  ]
}
```

---

### 4. 📊 Structured Execution Logs
**ID:** `4545e25f-1c14-43ad-a2e4-06ac79786273`
**Requirement:** agent_log.json with decisions, tool calls, retries, failures
**Current State:** Session logs in `.bowman/memory/sessions/` but not standardized
**Gap:** Need agent_log.json format compliant with challenge
**Priority:** MEDIUM - proves autonomy

**agent_log.json Structure:**
```json
{
  "session_id": "...",
  "agent_id": "0x...",
  "start_time": "2026-03-29T10:00:00Z",
  "decisions": [
    {
      "timestamp": "...",
      "context": "Discovered aim X needs work",
      "reasoning": "High priority, unblocked, within capabilities",
      "action": "Decompose into sub-aims"
    }
  ],
  "tool_calls": [...],
  "retries": [...],
  "failures": [...],
  "final_output": {...}
}
```

---

### 5. 🔧 Multi-Tool Orchestration (25% of judging)
**ID:** `c8016ad1-fa37-45e4-af5d-875acb5c4b5a`
**Requirement:** Coordinate multiple tools/APIs intelligently
**Current State:** Can use tools when instructed
**Gap:** Need autonomous tool selection and orchestration
**Priority:** HIGH - significant scoring weight

**Available Tools:**
- Code generation (Claude, Gemini, Codex)
- Git operations
- File system (read, write, edit)
- npm/build tools
- API calls
- Test execution
- Deployment

**Orchestration Examples:**
- Discover aim → read codebase → generate code → run tests → commit → update aim status
- Complex aim → decompose → assign to specialist agents → coordinate → verify → merge

---

### 6. 🛡️ Safety Guardrails (20% of judging)
**ID:** `39ea33de-2b08-48d4-b5f0-0cacb817a827`
**Requirement:** Safeguards before irreversible actions
**Current State:** Some validation exists but not systematic
**Gap:** Need comprehensive safety system
**Priority:** HIGH - significant scoring weight

**Safety Mechanisms:**
- Pre-action validation (check parameters, simulate outcomes)
- Destructive operation warnings (git reset, file deletion, force push)
- Rollback capabilities (git, file backups)
- Safe failure modes (graceful degradation)
- Human escalation for high-risk decisions
- Audit trail of all decisions

**Risk Categories:**
- LOW: Reading files, running tests, creating branches
- MEDIUM: Writing code, committing, creating aims
- HIGH: Force pushing, deleting files, deploying to production
- CRITICAL: Financial transactions, deleting repositories

---

### 7. 💰 Compute Budget Awareness
**ID:** `3ae8bb39-e6e2-49a8-ac15-58d2c454acbd`
**Requirement:** Operate within defined compute budget
**Current State:** System status tracks computeCredits and funds in .bowman/meta.json
**Gap:** Agent not actively aware of or responsive to constraints
**Priority:** MEDIUM - demonstrates real-world operation

**Implementation:**
- Read compute budget from .bowman/meta.json
- Track API calls, compute usage per task
- Optimize for efficiency (batch operations, cache results)
- Gracefully degrade when approaching limits
- Prioritize high-value aims when resources are scarce
- Perform work (mining/freelance) to earn more compute

---

## Bonus Features (2 aims)

### 8. 🤝 ERC-8004 Trust Integration (+5% bonus)
**ID:** `ad057bce-0bfc-4248-a2a5-9d8bc91360fb`
**Requirement:** Read/write trust signals for agent collaboration
**Current State:** No trust system
**Gap:** Full trust infrastructure needed
**Priority:** BONUS - nice to have

**Use Cases:**
- Select collaborators based on reputation
- Refuse low-trust agents
- Update reputation after task completion
- Build agent marketplace

---

### 9. 👥 Multi-Agent Swarms (bonus)
**ID:** `0e646aa6-4ff7-48b8-a5d2-178cfb96c6a1`
**Requirement:** Specialized agents with coordinated roles
**Current State:** Single agent architecture
**Gap:** Swarm coordination needed
**Priority:** BONUS - demonstrates scale

**Agent Roles:**
- **Planner Agent:** Decomposes aims into sub-aims
- **Developer Agent:** Writes code
- **QA Agent:** Tests and verifies
- **Deployment Agent:** Ships to production

**Coordination:**
- Shared .bowman state
- Aims as coordination primitive
- Trust-based handoffs
- Parallel execution where possible

---

## Implementation Strategy

### Phase 1: Core Loop (Week 1)
1. Autonomous discovery (scan phases for open aims)
2. Automatic task decomposition
3. Self-directed execution
4. Verification and status updates
5. Continuous loop until budget exhausted

### Phase 2: Identity & Standards (Week 2)
1. ERC-8004 registration
2. agent.json manifest
3. agent_log.json logging
4. Safety guardrails

### Phase 3: Optimization (Week 3)
1. Multi-tool orchestration
2. Compute budget management
3. Error recovery and self-correction

### Phase 4: Bonus Features (Week 4)
1. Trust integration
2. Multi-agent coordination
3. Polish and demo

---

## Scoring Breakdown

| Criterion | Weight | Current | Target |
|-----------|--------|---------|--------|
| Autonomy | 35% | 20% | 90% |
| Tool Use | 25% | 40% | 85% |
| Guardrails | 20% | 30% | 80% |
| Impact | 15% | 60% | 90% |
| ERC-8004 | 5% | 0% | 80% |
| **Total** | **100%** | **~30%** | **~87%** |

**Current estimated score:** ~30/100
**Target score:** 87+/100 (competitive for 1st place)

---

## Why This Approach Works

1. **Not a hackathon demo** - Building real autonomous capabilities
2. **Industry alignment** - Following standardized agent requirements
3. **Systematic development** - Each aim addresses a specific gap
4. **Measurable progress** - Clear success criteria for each capability
5. **Sustainable architecture** - Not hacky shortcuts, real engineering
6. **ASI pathway** - These are fundamental capabilities for superintelligence

---

## Key Differentiators vs Competition

Most hackathon projects will build:
- Scripted demos that look autonomous
- Single-use prototypes
- Tightly coupled to specific tasks

Aimparency will demonstrate:
- **Real autonomy** - Continuous loop, self-directed operation
- **Production system** - Already working, just adding autonomy layer
- **Verifiable history** - Git-backed aims prove real work
- **Novel coordination** - Aims as primitive for agent coordination
- **Practical safety** - Real guardrails, not checkbox features

---

## Success Metrics

### Technical
- [ ] Agent runs for 1 hour without human intervention
- [ ] Successfully completes 3+ aims autonomously
- [ ] Self-corrects after at least 1 error
- [ ] Operates within compute budget
- [ ] agent_log.json proves autonomous operation

### Business
- [ ] Competitive for top 3 in Agent Only ($500-$2000)
- [ ] Qualifies for Existing Code track ($5000)
- [ ] Foundation for continued ASI development
- [ ] Valuable regardless of prize outcome

---

## Current Status

- ✅ North star aim created
- ✅ 9 supporting aims defined
- ⏳ Implementation not started
- ⏳ ERC-8004 identity not registered
- ⏳ Autonomous loop not implemented

**Next Step:** Begin Phase 1 - implement autonomous discovery and execution loop

---

## Resources

- Challenge: https://pl-genesis-frontiers-of-collaboration-hackathon.devspot.app/
- ERC-8004 Spec: (to be researched)
- DevSpot Agent Manifest: (to be researched)
- Aimparency Codebase: `/home/felix/dev/aimparency/v7/`

---

*This roadmap treats the "Agent Only" challenge as an ASI development framework, not a one-off hackathon submission. The capabilities we build here are fundamental to achieving autonomous superintelligence.*
