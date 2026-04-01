# Aimparency x PL_Genesis

This repository is our **PL_Genesis Existing Code** submission for **Agent Only: Let the Agent Cook**.

- **Build path:** Existing Code
- **Chosen bounty:** Agent Only: Let the Agent Cook
- **Sponsor:** Ethereum Foundation

Aimparency is a local-first planning and coordination tool for work that lives next to real repositories. It stores project state in `.bowman/`, has a browser UI, and can start local agent sessions through a broker.

We chose this bounty because the project is aimed at the loop:

`discover -> plan -> execute -> verify -> submit`

What exists today:

- a local-first app for managing aims, phases, and project state
- broker-managed local agent sessions
- persistent runtime state under `.bowman/runtime`
- watchdog / animator infrastructure for autonomous execution
- project-local autonomy policy scaffolding

What is still missing for a strong final submission:

- final ERC-8004 identity registration and operator-wallet documentation
- a machine-readable `agent.json`
- structured execution logs
- a cleaner end-to-end autonomous demo

This repo existed before the event. The hackathon work was mainly:

- pushing more autonomy state into durable project-local runtime files
- improving watchdog persistence and reconnect behavior
- advancing the animator / state-machine direction for autonomous loops
- improving local-first onboarding and docs

## Run Locally

```bash
npm install
npm run dev
```

Then open `http://localhost:4000`.

## References

- Main project overview: [README.md](./README.md)
- Agent Only bounty notes: [pl_genesis_application/06-agent-only-let-agent-cook.md](./pl_genesis_application/06-agent-only-let-agent-cook.md)
- Autonomy runtime direction: [meta/autonomy-runtime.md](./meta/autonomy-runtime.md)
