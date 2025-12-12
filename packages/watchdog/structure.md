# Watchdog Project Structure

The Watchdog is the external "driver" loop that wraps the Gemini CLI to ensure continuous agency.

## Contents
- `src/`: Source code for the wrapper (likely Node.js or Python).
- `scripts/`: Helper scripts for starting/managing the watchdog.

## Architecture
The Watchdog:
1. Spawns the Gemini CLI process.
2. Monitors `stdout` for idle states or prompts.
3. Injects prompts via `stdin` to keep the agent focused on the `aimparency` mission.
4. Implements safety checks (max cycles, cost limits).

## Context
This project implements the "Autonomy" layer described in the mission. It converts the reactive CLI tool into a proactive agent.