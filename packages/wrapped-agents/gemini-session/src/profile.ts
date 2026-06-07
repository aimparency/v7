import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  BRAILLE_SPINNER,
  ESC_TO_INTERRUPT,
  TIMED_CANCEL,
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

  // NOTE: not yet verified against a live Gemini TUI. Gemini renders a Braille
  // spinner while generating; the busy footers below are the generic ones. The
  // Claude-specific footers (/btw to ask/, /interrupting Claude/) were dropped
  // since they never match Gemini. Tighten once observed against a real session.
  spinnerPattern: BRAILLE_SPINNER,
  busyPatterns: [ESC_TO_INTERRUPT, TIMED_CANCEL],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
