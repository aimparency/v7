# Agent Only: Let the Agent Cook

## Challenge Information
- **Sponsor:** Ethereum Foundation
- **Prize Pool:** $4,000
- **Category:** Shared Track (Synthesis Hackathon × PL_Genesis)

## Challenge Overview

No Humans Required — $8,000 total across both hackathons.

This is a shared track across Synthesis Hackathon × PL_Genesis.

Start at Synthesis: build fully autonomous systems where agents plan, execute, and coordinate without human intervention. Then continue at PL_Genesis: refine, extend, and push your system further through March 31.

Let the agent cook.

This challenge focuses on building fully autonomous agents that can operate end-to-end without human assistance.

Your agent should be capable of discovering a problem, planning a solution, executing tasks using real tools, and producing a meaningful output.

We are looking for agents that behave more like independent operators than scripts.

The best projects will demonstrate that agents can function as self-directed builders in real environments.

## Required Capabilities

### 1. Autonomous Execution
Your agent must complete a full decision loop:
- discover → plan → execute → verify → submit

Human involvement should be minimal after the initial launch.

Agents should demonstrate:
- task decomposition
- autonomous decision making
- self-correction when errors occur

### 2. Agent Identity
Your agent must register a unique ERC-8004 identity and associate itself with an agent operator.

An agent operator is the entity responsible for configuring and deploying the agent.

Your project should include:
- agent identity
- operator wallet
- ERC-8004 registration transaction

This identity layer enables agents to participate in trust-based ecosystems.

### 3. Agent Capability Manifest
Each submission must include a machine-readable capability file.

Example: agent.json

Suggested fields:
- agent name
- operator wallet
- ERC-8004 identity
- supported tools
- supported tech stacks
- compute constraints
- supported task categories

### 4. Structured Execution Logs
Agents must produce structured execution logs showing:
- decisions
- tool calls
- retries
- failures
- final outputs

Example output file: agent_log.json

These logs help verify that the agent operated autonomously.

### 5. Tool Use
Agents must interact with real tools or APIs.

Examples include:
- code generation tools
- GitHub
- blockchain transactions
- data APIs
- deployment platforms

Single-tool usage will score lower than multi-tool orchestration.

### 6. Safety and Guardrails
Agents should include safeguards before performing irreversible actions.

Examples:
- validating transaction parameters
- confirming API outputs
- detecting unsafe operations
- aborting or retrying safely

### 7. Compute Budget Awareness
Your agent should operate within a defined compute budget.

Agents should demonstrate efficient resource usage and avoid excessive calls or runaway loops. This mirrors real-world environments where agents must operate under cost constraints.

## Optional (Bonus) Features

### ERC-8004 Trust Integration
Agents that read or write ERC-8004 trust signals will receive bonus points.

Example use cases:
- selecting collaborators based on reputation
- refusing to interact with low-trust agents
- updating reputation after task completion

### Multi-Agent Swarms
Submissions may include multiple cooperating agents with specialized roles.

Example roles:
- planner
- developer
- QA agent
- deployment agent

## Judging Criteria

Projects will be evaluated across five dimensions:

- **Autonomy (35%)** - Did the agent operate independently through a full decision loop?
- **Tool Use (25%)** - How effectively did the agent orchestrate real tools and APIs?
- **Guardrails & Safety (20%)** - Did the agent include meaningful safeguards and validation?
- **Impact (15%)** - Does the system solve a real problem?
- **ERC-8004 Integration (Bonus 5%)** - Did the agent leverage onchain trust signals?

## Example Project Ideas

For example, your agent could:
- Discover a challenge in the hackathon
- Plan a strategy to solve it
- Write code or orchestrate tools
- Generate and deploy a working solution
- Submit the result automatically

## Prizes

- **1st Place:** $2,000
- **2nd Place:** $1,500
- **3rd Place:** $500

## Submission Requirements

- summary
- video
- github
- demo
- documentation
