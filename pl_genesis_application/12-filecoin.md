# Filecoin

## Challenge Information
- **Sponsor:** Filecoin Foundation
- **Prize Pool:** $2,500
- **Category:** Agent Infrastructure

## Challenge Overview

The future of AI belongs to agents that operate autonomously, coordinate trustlessly, and sustain themselves economically without centralized control. Filecoin is sponsoring challenges that build the foundational infrastructure to make this vision real. These bounties focus on enabling agents to independently manage data on Filecoin, establish verifiable identities and reputations, coordinate securely with other agents, and participate in real economic systems. Developers will create the core primitives that allow AI agents to store state, broker storage deals, monetize datasets, and sustain themselves under actual cost constraints. By anchoring agent operations on Filecoin's decentralized network, these challenges establish the building blocks for a new paradigm where autonomous agents discover, trust, and transact at scale.

## Ideas

### 1. Agent Storage SDK

**Challenge Overview:** Build a framework-agnostic SDK that enables AI agents to autonomously store, retrieve, and manage data on Filecoin via FOC without human intervention.

**Bounty Description:**
- Minimal agent storage interface (store, retrieve, renew, prune)
- Agent-usable wallet abstraction with cross-chain funding
- Default storage policies (cost, redundancy, TTL)
- Deployment on calibnet (mainnet bonus) with integration docs

### 2. Onchain Agent Registry

**Challenge Overview:** Deploy AI agents as first-class onchain entities with persistent metadata, state, and logs stored on Filecoin, enabling large-scale discovery and coordination.

**Bounty Description:**
- Ethereum-based registry contracts
- Filecoin-backed metadata, state, and execution logs
- Multi-agent coordination demo
- Explorer/dashboard visualizing agents and storage activity

### 3. Agent Reputation & Portable Identity

**Challenge Overview:** Design a tamper-resistant, portable identity system where agent reputation is derived from verifiable history anchored on Filecoin.

**Bounty Description:**
- CID-rooted identity objects stored on Filecoin
- Reputation scoring from historical data
- Proof-of-history demo
- Cross-environment identity portability + verifier tooling

### 4. Autonomous Agent Economy

**Challenge Overview:** Create a live onchain economic environment where AI agents operate under real cost constraints and must sustain themselves.

**Bounty Description:**
- Onchain budget and fee rules
- Filecoin-backed agent state
- Live agent cohort under real economic limits
- Transparent dashboard + post-mortem analysis

### 5. Fee-Gated Agent Communication

**Challenge Overview:** Build a secure, peer-to-peer messaging protocol for AI agents with onchain fee enforcement and Filecoin-backed message archives.

**Bounty Description:**
- Encrypted P2P agent messaging
- Onchain fee/staking mechanism
- Filecoin-backed message persistence
- Live demo with spam-resistance experiment

### 6. Autonomous Infrastructure Brokerage

**Challenge Overview:** Develop broker agents that autonomously evaluate, negotiate, and manage Filecoin storage deals for other agents.

**Bounty Description:**
- Storage deal comparison + recommendation engine
- Automated deal creation and migration
- Onchain commission/fee model
- Metrics dashboard (deals, savings, retention)

### 7. Agent-Generated Data Marketplace

**Challenge Overview:** Build a marketplace where AI agents generate, price, and sell Filecoin-backed datasets with verifiable provenance and onchain settlement.

**Bounty Description:**
- Marketplace contracts (listing, escrow, settlement)
- CID-rooted dataset storage
- Producer + consumer agent demo
- Revenue and transaction dashboard

## Submission Requirements

1. Your project must use Synapse SDK or Filecoin Pin in a meaningful way (storage, retrieval, or payment)
2. Your project must deploy to the Filecoin Calibration Testnet
3. Must include a working demo (frontend or CLI)
4. Open-source code submitted via GitHub
5. Demo Video of the project

## Judging Criteria

- **Technical Execution | 40%** - Does the project demonstrate quality application development? Does the project leverage Filecoin Onchain Cloud? Is the code of good quality and is it functional?
- **Potential Impact | 20%** - How big of an impact could the project have in the real world? How useful is the project to a broad market of users? How significant is the problem the project addresses, and does it efficiently solve it?
- **Innovation / Wow Factor | 30%** - How novel and original is the idea? Does it address a significant problem or create a unique solution?
- **Presentation / Demo | 10%** - Is the problem clearly defined, and is the solution effectively presented through a demo and documentation? Have they explained how they used Synapse SDK and Filecoin Pin? Have they included documentation or an architectural diagram?

## Resources

- Filecoin Documentation
- Developer Tool
- Starter Kit
- Dev Tool/SDK
- Dev Tool/SDL

## Prizes

- **1st Place:** $1,250
- **2nd Place:** $750
- **3rd Place:** $500
