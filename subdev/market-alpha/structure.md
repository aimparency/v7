# Market Alpha: RL Trading Environment

This project implements an autonomous reinforcement learning environment for financial market interaction ("AlphaZero for Markets").

## Architecture
- `env/`: Gym-compatible environment wrapping market data.
- `agent/`: RL agent implementations (PPO, DQN, Transformer-based).
- `data/`: Connectors for historical and live market data (Yahoo Finance, Binance, etc.).
- `paper/`: Paper trading execution engine.

## Philosophy
Markets are treated as a truth-seeking mechanism. The agent's goal is to converge on accurate world-modeling through efficient capital allocation.
