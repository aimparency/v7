import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  CLAUDE_STYLE_SPINNER,
  CLAUDE_STYLE_BUSY_PATTERNS,
} from '@aimparency/wrapped-agents-common';

export const geminiProfile: AgentProfile = {
  agentType: 'gemini',
  command: 'gemini',
  cols: 120,
  bannerName: 'Gemini',
  defaultWorkerModel: 'gemini-3.1-pro-preview',
  defaultWatchdogModel: 'gemini-3.1-flash-lite-preview',

  buildWorkerArgs: ({ resume, workerModel }) => {
    const args = resume
      ? ['--resume', 'latest', '--approval-mode', 'auto_edit']
      : ['--approval-mode', 'auto_edit'];
    if (workerModel !== undefined) args.push('--model', workerModel);
    return args;
  },
  buildWatchdogArgs: ({ watchdogModel }) => {
    const args: string[] = [];
    if (watchdogModel !== undefined) args.push('--model', watchdogModel);
    return args;
  },
  resumeFailurePatterns: [/No previous sessions found/],

  // NOTE: these are inherited from the as-shipped (Claude-derived) detection and
  // include Claude-specific footers (/btw to ask/, /interrupting Claude/) that
  // likely never match Gemini's TUI. Verify against a live Gemini session and
  // tighten if needed — they are isolated here now, not shared.
  spinnerPattern: CLAUDE_STYLE_SPINNER,
  busyPatterns: CLAUDE_STYLE_BUSY_PATTERNS,
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
