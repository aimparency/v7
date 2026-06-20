import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  ESC_TO_INTERRUPT,
  TIMED_CANCEL,
} from '@aimparency/wrapped-agents-common';

export const grokProfile: AgentProfile = {
  agentType: 'grok',
  command: 'grok',
  bannerName: 'Grok',
  // xAI model names are typically 'grok-3', 'grok-3-mini', etc.
  // Leave undefined to let the CLI choose its current default.
  defaultWorkerModel: undefined,
  defaultWatchdogModel: undefined,

  buildWorkerArgs: ({ resume, workerModel }) => {
    // Modeled after common patterns; adjust if grok CLI uses different resume flag
    // (e.g. 'resume' subcommand like codex or '--resume latest' like gemini).
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
  resumeFailurePatterns: [/No conversation found/, /No sessions found/, /No previous sessions?/i],

  // Grok's TUI is likely Ink-based. Use the generic esc/timed footers plus
  // the common choice menu shapes. Spinner detection may need tuning after
  // observing a real session (many xAI/CLI TUIs use animated Braille or dots).
  spinnerPattern: /(?:…|\.\.\.)\s*\((?:\d+h\s*)?(?:\d+m\s*)?\d+s\b|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|[\u2800-\u28FF]/,
  busyPatterns: [ESC_TO_INTERRUPT, TIMED_CANCEL],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
