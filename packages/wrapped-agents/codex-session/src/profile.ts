import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  CODEX_STYLE_SPINNER,
  CODEX_STYLE_BUSY_PATTERNS,
} from '@aimparency/wrapped-agents-common';

export const codexProfile: AgentProfile = {
  agentType: 'codex',
  command: 'codex',
  bannerName: 'Codex',
  // undefined => use the CLI's own default models
  defaultWorkerModel: undefined,
  defaultWatchdogModel: undefined,

  buildWorkerArgs: ({ resume, workerModel }) => {
    // Order matters for codex: global flags precede the `resume` subcommand.
    const args: string[] = [];
    if (workerModel !== undefined) args.push('--model', workerModel);
    if (resume) args.push('resume', '--last');
    return args;
  },
  buildWatchdogArgs: ({ watchdogModel }) => {
    const args: string[] = [];
    if (watchdogModel !== undefined) args.push('--model', watchdogModel);
    return args;
  },
  resumeFailurePatterns: [
    /(No sessions found|No session found|No previous sessions found|No conversation found|Could not find.*session)/i,
  ],
  relaunchOnNonZeroExit: true,

  spinnerPattern: CODEX_STYLE_SPINNER,
  busyPatterns: CODEX_STYLE_BUSY_PATTERNS,
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
