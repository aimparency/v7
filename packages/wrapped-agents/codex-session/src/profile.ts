import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  ESC_TO_INTERRUPT,
  TIMED_CANCEL,
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

  // Codex shows a narrow rotating Braille spinner (just these 10 glyphs) plus
  // the esc-to-interrupt / countdown footers — no star glyphs.
  spinnerPattern: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,
  busyPatterns: [ESC_TO_INTERRUPT, TIMED_CANCEL],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
