# Aimparency x PL_Genesis

This repository is our **PL_Genesis Existing Code** submission for **Agent Only: Let the Agent Cook**.

- **Build path:** Existing Code
- **Chosen bounty:** Agent Only: Let the Agent Cook
- **Sponsor:** Ethereum Foundation

Aimparency is a local-first planning and coordination tool for work that lives next to real repositories. It stores project state in `.bowman/`, has a browser UI, and can start local agent sessions through a broker.

We chose this bounty because the project is aimed at achieving autonomous AI. 
Our approach is to have the agent maintain a (maybe human co-authored) graph of aims for pursuing long term goals and strategies. 

What exists today:

- a local-first app for managing an aim graph 
- MCP for llms to interact with the aim graph
- watchdog / animator infrastructure for autonomous LLM execution loop


The hackathon work was:

- adding Codex as a wrapped agent session and extending the local multi-agent runtime
- refactoring the frontend UI stores and navigation/editing flow 
- adding structured reflections for autonomous learning
- improving watchdog persistence, reconnect behavior, and runtime ownership visibility
- building and integrating a declarative animator state machine for the autonomous loop
- improving local project discovery, startup/runtime handling, and release-facing documentation

## Run Locally

```bash
npm install
npm run dev
```

Then open `http://localhost:4000`.

