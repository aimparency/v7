#!/usr/bin/env bash
# on-stop.sh - Codex exit hook script for Aimparency workspace

# ANSI colors
CYAN='\033[1;36m'
RESET='\033[0m'
GRAY='\033[90m'

echo -e "${GRAY}┌────────────────────────────────────────────────────────┐${RESET}"
echo -e "${GRAY}│${RESET}  ${CYAN}[Watchdog]${RESET} Codex has stopped.                         ${GRAY}│${RESET}"
echo -e "${GRAY}│${RESET}  Check Aimparency aims and find something to work on!  ${GRAY}│${RESET}"
echo -e "${GRAY}└────────────────────────────────────────────────────────┘${RESET}"
