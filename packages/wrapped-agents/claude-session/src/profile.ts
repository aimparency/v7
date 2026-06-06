import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  CLAUDE_STYLE_SPINNER,
  CLAUDE_STYLE_BUSY_PATTERNS,
} from '@aimparency/wrapped-agents-common';

export const claudeProfile: AgentProfile = {
  agentType: 'claude',
  command: 'claude',
  bannerName: 'Claude',
  // Worker on the most capable model (Opus); supervisor on fast/cheap Haiku.
  defaultWorkerModel: 'opus',
  defaultWatchdogModel: 'haiku',

  buildWorkerArgs: ({ resume, workerModel }) => {
    const args = resume
      ? ['--continue', '--dangerously-skip-permissions']
      : ['--dangerously-skip-permissions'];
    if (workerModel !== undefined) args.push('--model', workerModel);
    return args;
  },
  buildWatchdogArgs: ({ watchdogModel }) => {
    const args = ['--dangerously-skip-permissions'];
    if (watchdogModel !== undefined) args.push('--model', watchdogModel);
    return args;
  },
  resumeFailurePatterns: [/No conversation found/, /No sessions found/],

  spinnerPattern: CLAUDE_STYLE_SPINNER,
  busyPatterns: CLAUDE_STYLE_BUSY_PATTERNS,
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
