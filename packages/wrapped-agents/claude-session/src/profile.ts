import {
  type AgentProfile,
  COMMON_CHOICE_MENU_PATTERNS,
  ESC_TO_INTERRUPT,
  TIMED_CANCEL,
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

  // Claude's live status line is "<glyph> <Verb>… (<elapsed> · ↑ <tokens>)",
  // e.g. "· Quantumizing… (3m 21s · ↑ 13.7k tokens)". Two things vary frame to
  // frame and must NOT be relied on: the leading glyph animates (✻ ✶ ✢ * · …)
  // and the footer is a rotating tip (sometimes "esc to interrupt", sometimes
  // "/btw to ask", sometimes neither). The stable invariant is an ellipsis
  // immediately followed by a parenthesised elapsed-time counter. The completed
  // summary ("✻ Baked for 6s") has no "… (Ns", so this cleanly separates active
  // from idle without depending on the glyph. (Braille is agy's spinner.)
  spinnerPattern: /(?:…|\.\.\.)\s*\((?:\d+h\s*)?(?:\d+m\s*)?\d+s\b/,
  // Secondary signals — only some frames show these, so they merely accelerate
  // detection; the structural spinner pattern above is the reliable one.
  busyPatterns: [
    ESC_TO_INTERRUPT,
    TIMED_CANCEL,
    /\/btw to ask/i,
    /interrupting Claude/i,
  ],
  choiceMenuPatterns: COMMON_CHOICE_MENU_PATTERNS,
  compactCommand: '/compact',
};
