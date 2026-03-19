# Aimparency Local Autonomy Runtime

## Purpose

Aimparency should grow from "a browser UI for editing an aim graph" into "a local autonomy substrate" that can keep useful agent loops alive on a user's machine.

The closest external reference is Conway Research's `automaton` project. Its strongest ideas are:

- a continuously running think -> act -> observe loop
- a heartbeat daemon that continues between turns
- durable identity and self-authored state
- auditability around self-modification
- survival pressure through resource constraints

Aimparency should borrow the useful runtime ideas without inheriting the cloud-first or finance-first assumptions. The local-first version should remain:

- local service first
- `.bowman` and git friendly
- inspectable by a human owner
- useful even without payment rails or hosted infrastructure

## Core Hypothesis

The aim graph is not just a planning UI. It can become the long-term memory and objective substrate for a local autonomous agent.

In that framing:

- aims are durable goals and constraints
- phases are medium-horizon plans
- reflections are learned policy updates
- watchdog sessions are short-lived execution workers
- the local service is the durable runtime that decides when to spawn, resume, steer, and stop workers

## Proposed Runtime Split

### 1. Local autonomy daemon

The backend/broker side should evolve into a durable autonomy daemon with ownership over:

- project-local autonomy state
- scheduler / heartbeat ticks
- worker session lifecycle
- recovery after restart
- audit trail of autonomous actions

The frontend should observe and control this daemon, not own the autonomy loop.

### 2. Worker sessions

Claude, Codex, Gemini, or future workers remain replaceable execution engines.

They should:

- receive bounded tasks or next actions
- work inside a repo or workspace
- produce observations, diffs, commits, reflections, and requests for help

They should not be the only place where long-running intent lives.

### 3. `.bowman` as durable autonomy state

Long-running autonomy state should live in `.bowman`, not in browser local storage and not only in broker memory.

Candidate files or directories:

- `.bowman/runtime/identity.json`
- `.bowman/runtime/constitution.md`
- `.bowman/runtime/objectives.json`
- `.bowman/runtime/heartbeat.json`
- `.bowman/runtime/sessions.json`
- `.bowman/runtime/audit/`

This keeps the system inspectable, recoverable, and git-friendly.

## Mapping Automaton Concepts into Aimparency

### Think -> Act -> Observe

Native Aimparency mapping:

- Think:
  read prioritized aims, current phase, reflections, project state, repo state, runtime policy
- Act:
  spawn or resume a worker, run tools, modify files, write aims, update status
- Observe:
  capture command results, git diff, test results, reflection, human feedback

### Heartbeat daemon

Native Aimparency mapping:

- periodic check for open aims in active phases
- refresh project health and repo status
- evaluate whether a worker should continue, stop, or hand off
- expire abandoned sessions after lease timeout

This is already partially hinted at by watchdog keepalive logic, but the durable source of truth should move into the local runtime.

### Identity / SOUL

Aimparency does not need a mystical identity file, but it does need durable agent-level self-description.

Useful local equivalent:

- runtime name / persona
- stable operating principles
- preferred worker models
- areas of responsibility
- learned heuristics from reflections

This should be editable by the human owner and partially writable by the system under audit.

### Constitution / policy

Aimparency should support a local constitutional layer before more aggressive autonomy work.

Candidate policy sections:

- hard safety boundaries
- repo modification boundaries
- commit / review requirements
- spending / network permissions
- when to ask the human
- when to stop

### Economic survival pressure

This should be modeled, but not made mandatory for the local-first product.

Short-term local equivalent:

- compute budget
- token budget
- human attention budget
- test/runtime cost tracking

Longer-term:

- real payment rails
- paid task execution
- self-funded compute

## What Aimparency Should Not Copy Directly

- cloud dependence as the default runtime
- opaque remote provisioning as the default action model
- identity that depends on chain registration
- self-replication before local operator trust, audit, and control are strong

Those may become optional future integrations, but they should not define the core architecture.

## Near-Term Engineering Direction

### Stage 1. Durable local autonomy state

Move autonomy state from frontend session memory into `.bowman/runtime`.

Priority targets:

- restore running autonomy after browser reload
- recover after backend restart
- persist active worker metadata and heartbeat state
- store autonomy settings per project

### Stage 2. Scheduler / heartbeat in the local service

Introduce a backend-owned loop that can:

- periodically inspect active aims
- enqueue candidate work
- resume a worker if policy allows
- stop workers after timeout without frontend presence

### Stage 3. Native "autonomy policy" model

Represent operator-approved autonomy rules explicitly instead of scattering them across prompts and ad hoc watchdog instructions.

### Stage 4. Integration boundary

Once the native local runtime is coherent, define a compatibility layer for automaton-style systems.

Potential integration points:

- import/export of identity and policy
- shared audit log format
- heartbeat task adapters
- optional external economic modules

## Concrete Hypotheses

### Hypothesis A

If long-running autonomy state is moved into `.bowman/runtime`, Aimparency becomes much more resilient across reloads, restarts, and multi-agent execution.

### Hypothesis B

If the local runtime owns heartbeat and leasing, the watchdog UI can become a monitor/control surface rather than a hidden dependency.

### Hypothesis C

If autonomy policy is first-class and inspectable, users will trust stronger local autonomy features much sooner than if they are encoded only in prompts.

### Hypothesis D

Automaton-style integration is more valuable as a compatibility boundary than as a direct architectural transplant.

Aimparency's strength is the graph, local repo integration, and inspectable memory. Those should remain primary.

## Suggested Next Implementation Steps

1. Persist autonomy runtime state under `.bowman/runtime`.
2. Define a backend-owned heartbeat/lease model for worker sessions.
3. Add an explicit autonomy policy document and UI surface.
4. Show current autonomy mode, active worker, lease age, and owning project clearly in the UI.
5. Only then explore deeper compatibility with external autonomy runtimes.
