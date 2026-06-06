import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  CLAUDE_STYLE_SPINNER,
  CLAUDE_STYLE_BUSY_PATTERNS,
} from '@aimparency/wrapped-agents-common';

export const agyProfile: AgentProfile = {
  agentType: 'agy',
  command: 'agy',
  bannerName: 'Antigravity (agy)',
  // undefined => use the CLI's own default models
  defaultWorkerModel: undefined,
  defaultWatchdogModel: undefined,

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
