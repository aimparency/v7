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

  // Grok's Ink TUI: rely on the elapsed-time spinner shape (like Claude) rather
  // than the full Braille block — idle screens often contain stray Braille/box
  // glyphs that falsely read as "generating" and wedge supervisor reply detection.
  //
  // For *reliable* "main worker halt" recognition (the supervisor needs to know
  // when the main agent has finished a turn), configure a hook in your grok CLI
  // that runs the on-halt script. See common/hooks/worker-halt-hook.sh .
  // The session wrapper injects AIMPARENCY_* env vars that the hook uses to
  // notify the broker -> session watchdog.
  spinnerPattern: /(?:…|\.\.\.)\s*\((?:\d+h\s*)?(?:\d+m\s*)?\d+s\b/,
  busyPatterns: [ESC_TO_INTERRUPT, TIMED_CANCEL],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  idleFooterPatterns: [/Turn completed in/i],
  compactCommand: '/compact',
  // Grok keeps a blinking prompt cursor in the footer; give it longer to settle.
  watchdogIdleStabilityMs: 2000,
};
