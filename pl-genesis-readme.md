# Aimparency x PL_Genesis

## Submission Summary

This repository is the **PL_Genesis Existing Code** submission for **Agent Only: Let the Agent Cook**.

- **Build Path:** Existing Code
- **Chosen Bounty:** Agent Only: Let the Agent Cook
- **Sponsor:** Ethereum Foundation
- **Hackathon Window for this README:** February 10, 2026 through March 31, 2026

Aimparency is a local-first planning and execution system for autonomous software work. It stores durable project state next to a real repository in `.bowman/`, exposes a browser UI, and can launch local worker sessions through a broker. The goal is not just to track tasks, but to let an agent discover work, plan, execute with tools, verify results, and persist what it learned.

This is an **Existing Code** entry because the repository and core product predate the hackathon. The hackathon work focused on extending the existing system into a stronger autonomous runtime and documenting a clearly bounded set of changes made during the event window.

## What Problem This Solves

Most agent demos are still prompt chains or single-run scripts. Aimparency is aimed at a harder problem: making a local agent operate as a durable builder inside a real repository with:

- persistent project memory
- explicit goals and subgoals
- executable workers with real tool access
- runtime state that survives reloads and restarts
- inspectable logs and guardrails

That makes it a direct fit for the bounty's requirement that the agent behave like an independent operator rather than a one-shot script.

## Why This Fits "Agent Only: Let the Agent Cook"

The bounty asks for an agent that can complete:

`discover -> plan -> execute -> verify -> submit`

Aimparency's architecture is built around that loop:

- **Discover:** open aims, current phase context, project state, repo state, and search are available as durable local context
- **Plan:** the aim graph and phase system provide structured decomposition and prioritization
- **Execute:** wrapped agents run local tool workflows against a real codebase
- **Verify:** tests, command results, diffs, and runtime observations are fed back into the system
- **Submit:** outcomes can be reflected into project state, committed in git, and prepared for external submission flows

The repo also already contains work toward:

- durable local runtime state in `.bowman/runtime`
- explicit autonomy policy
- watchdog / animator loops
- multi-agent-capable broker infrastructure
- project-local auditability

## Existing Code Declaration

This project existed before the February 10, 2026 kickoff. The pre-hackathon base included:

- the local-first Aimparency product
- the `.bowman` project-state model
- the frontend graph and columns UI
- the backend tRPC server
- the wrapped-agent broker and session infrastructure

The hackathon work below is the substantial addition and refinement implemented during the event window for this submission.

## Hackathon Changelog

The following changes were built or substantially advanced during the PL_Genesis event window and are the main basis for this submission:

### 1. Structured autonomy runtime improvements

- moved more long-running autonomy state into project-local `.bowman/runtime`
- scaffolded runtime audit and autonomy policy files
- exposed backend runtime state endpoints for durable watchdog metadata
- made reconnect and restoration behavior project-local rather than browser-local only

### 2. Animator / watchdog autonomy loop work

- implemented an explicit animator state-machine direction for the autonomous loop
- aligned the watchdog flow with structured actions rather than only loose prompt steering
- pushed the system toward a durable `discover -> plan -> execute -> verify -> wrap up` runtime

### 3. Persistent session and UI recovery

- persisted watchdog desired state, emergency-stop state, preferred agent type, and stop reason
- restored watchdog connection and session state across frontend reloads
- improved the frontend so a running local agent session can be reattached instead of being treated as lost browser state

### 4. Local-first onboarding and project connection improvements

- documented the local-first runtime and `.bowman` layout more clearly
- improved project discovery so the app can find nearby `.bowman` projects
- clarified the open-project flow for first-time users

### 5. Release and submission preparation

- cleaned up repository surface and onboarding docs for a public-facing local-first release
- clarified package roles and startup paths
- made the repository easier to inspect and evaluate as a real autonomous coding environment

## Bounty Requirement Mapping

### 1. Autonomous Execution

Aimparency is explicitly designed around autonomous work loops and durable execution context.

What this repo demonstrates:

- project-local goal graph and decomposition
- agent runtime with watchdog / animator control flow
- local worker sessions for real repo tasks
- verification-oriented workflow through tests, command results, and repo state
- persistent runtime state across reloads and restarts

### 2. Agent Identity

This bounty requires a unique ERC-8004 identity and operator association.

For this submission:

- **Agent system:** Aimparency local autonomy runtime
- **Operator:** the local project owner / deployer
- **ERC-8004 registration:** required by the bounty and should be attached as part of the final submission package

If the registration transaction, operator wallet, and trust metadata are stored separately for submission, link or reference them here before final submission.

### 3. Agent Capability Manifest

This submission should include a machine-readable capability manifest such as `agent.json`.

Suggested contents for the final artifact:

- agent name: `Aimparency`
- operator wallet
- ERC-8004 identity
- supported tools: local shell, git, tRPC backend, broker-managed workers, filesystem operations
- supported stacks: TypeScript, Vue, Node.js, local repo workflows
- compute constraints: local machine + configured model/runtime limits
- task categories: planning, coding, verification, project-state maintenance, autonomous repo work

### 4. Structured Execution Logs

Aimparency is built around inspectable local runtime state and auditability.

Relevant runtime/logging surfaces in this repo include:

- `.bowman/runtime/`
- `.bowman/runtime/audit/`
- watchdog state files
- broker / session state
- command and verification outputs captured through the worker flow

For final submission, include one or more structured machine-readable example logs showing:

- decisions
- tool calls
- retries
- failures
- final outputs

### 5. Tool Use

This project uses real tools rather than a single-model text loop.

Examples in the repo:

- filesystem operations on real repositories
- git-friendly project-state persistence
- local worker execution environments
- backend APIs
- broker-managed agent sessions
- test and verification commands

This is intended to score as a multi-tool autonomous system, not as a single-tool script.

### 6. Safety and Guardrails

Guardrails are a first-class part of the Aimparency direction.

Current guardrail surfaces include:

- explicit autonomy policy in `.bowman/runtime/autonomy-policy.json`
- operator-controlled local execution environment
- durable emergency-stop state
- project-local runtime inspection
- design emphasis on validation and bounded worker execution

### 7. Compute Budget Awareness

The project explicitly treats resource limits as part of autonomous operation.

Current direction includes:

- project-local runtime constraints
- watchdog/autonomy policy settings
- emphasis on bounded loops over runaway execution
- model/tool selection within a local operator-controlled environment

## Architecture Overview

Core packages:

- `packages/frontend` - browser UI for graph, columns, and runtime control
- `packages/backend` - local tRPC server and `.bowman` persistence
- `packages/wrapped-agents/broker` - agent session lifecycle manager
- `packages/wrapped-agents/*-session` - worker session backends
- `packages/shared` - shared types and logic

Core local data model:

- `.bowman/aims/`
- `.bowman/phases/`
- `.bowman/meta.json`
- `.bowman/runtime/`

This architecture is important for the bounty because it makes the agent durable, inspectable, and able to operate inside a real working environment.

## How To Run

From the repo root:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:4000
```

For the local-first workflow:

1. open Aimparency in the browser
2. point it at a local repo or workspace
3. let it create or use that repo's `.bowman` directory
4. start and observe local worker sessions through the runtime

## Demo Narrative

The demo for this submission should show:

1. a real repository opened in Aimparency
2. durable project context loaded from `.bowman`
3. an autonomous worker session launched through the broker
4. the runtime discovering or selecting work
5. planning and decomposition through the aim graph
6. tool use against the real repo
7. verification and runtime persistence
8. resulting state reflected back into the project

## What Is New Versus Pre-Hackathon

The key existing-code claim is:

- the repository and core product already existed
- the hackathon work pushed it materially toward a real autonomous runtime
- the changes were not cosmetic; they improved durable runtime state, watchdog behavior, local project onboarding, and autonomy-oriented product framing

That is the substantive change this README documents for the **Existing Code** category.

## Submission Checklist

Before final submission, attach or finalize:

- README for the hackathon submission
- public repository link
- demo video
- live or recorded demo flow
- machine-readable `agent.json`
- structured execution log example(s)
- operator wallet
- ERC-8004 registration transaction reference
- short note on guardrails and compute limits

## Repository References

- Main project overview: [README.md](./README.md)
- PL_Genesis challenge notes: [pl_genesis_application/README.md](./pl_genesis_application/README.md)
- Agent Only bounty notes: [pl_genesis_application/06-agent-only-let-agent-cook.md](./pl_genesis_application/06-agent-only-let-agent-cook.md)
- Autonomy runtime direction: [meta/autonomy-runtime.md](./meta/autonomy-runtime.md)
