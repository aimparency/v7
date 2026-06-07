import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  BRAILLE_SPINNER,
  ESC_TO_INTERRUPT,
  TIMED_CANCEL,
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

  // Antigravity renders an animated Braille spinner (⠀-⣿) while generating —
  // distinct from Claude's star glyphs. It's transient (gone once a turn ends),
  // so the bare glyph is a safe busy signal here.
  spinnerPattern: BRAILLE_SPINNER,
  busyPatterns: [ESC_TO_INTERRUPT, TIMED_CANCEL],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
