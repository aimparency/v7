/**
 * AgentProfile — the (thin) per-CLI configuration surface.
 *
 * Everything that genuinely differs between the wrapped coding agents
 * (claude / codex / gemini / agy) lives here. The watchdog loop, server
 * bootstrap, session memory and PTY wrapper are all shared in `common` and
 * consume a profile, so adding a new agent means writing one of these — not
 * copying ~800 lines of watchdog logic.
 */

export type AgentType = 'claude' | 'codex' | 'gemini' | 'agy' | 'grok';

export interface WorkerArgsContext {
  /** Whether to resume the previous session (vs. start fresh). */
  resume: boolean;
  workerModel?: string;
}

export interface WatchdogArgsContext {
  watchdogModel?: string;
}

export interface AgentProfile {
  /** Stable identifier used for runtime-state persistence keys. */
  agentType: AgentType;
  /** CLI executable to spawn (e.g. 'claude'). `.cmd` is appended on win32. */
  command: string;
  /** Terminal width for the spawned PTY. Defaults to 80. */
  cols?: number;
  /** Human-readable name used in startup banners. */
  bannerName: string;

  /** Default models when not overridden by CLI args. `undefined` = CLI default. */
  defaultWorkerModel?: string;
  defaultWatchdogModel?: string;

  /** Build the worker (main coding agent) spawn args. */
  buildWorkerArgs(ctx: WorkerArgsContext): string[];
  /** Build the watchdog (supervisor) spawn args. */
  buildWatchdogArgs(ctx: WatchdogArgsContext): string[];

  /** Patterns in worker output that indicate a failed `--resume`/`--continue`. */
  resumeFailurePatterns: RegExp[];
  /** When true, a non-zero worker exit during resume triggers a fresh relaunch. */
  relaunchOnNonZeroExit?: boolean;

  // ---- TUI detection (consumed by the shared watchdog loop) ----
  /** Spinner/progress glyphs that mean "the agent is generating". */
  spinnerPattern: RegExp;
  /** Text footers that mean "busy" (e.g. /esc to interrupt/). */
  busyPatterns: RegExp[];
  /** Patterns that mean "a choice menu is visible and awaiting input". */
  choiceMenuPatterns: RegExp[];

  /**
   * Footers that mean a turn has *finished* (e.g. Grok's "Turn completed in
   * 13s."). When matched in the recent viewport, overrides spinner/busy
   * signals so idle detection and supervisor reply parsing can proceed.
   */
  idleFooterPatterns?: RegExp[];

  /** Command sent to the worker to compact its context (e.g. '/compact'). */
  compactCommand: string;

  /**
   * How long the supervisor's bottom region must be unchanged before we treat
   * its reply as complete. Defaults to 100ms. Ink-based TUIs (e.g. grok) often
   * keep a blinking cursor or status line ticking, so a longer window avoids
   * "waiting for supervisor reply" wedging despite a finished answer on screen.
   */
  watchdogIdleStabilityMs?: number;
}

// ---- Low-level detection building blocks ----
// These are just *spellings* of individual matchers, kept here so a tricky
// regex (e.g. the countdown footer) isn't re-typed in every profile. The
// per-agent detection *policy* — which spinner glyphs / busy footers actually
// apply to a given CLI — lives in that agent's profile, not here, because each
// wrapped TUI renders differently (e.g. the Braille spinner is agy's, not
// Claude's). Compose these into `spinnerPattern` / `busyPatterns` per profile.

/** Choice-menu shapes common to the supported CLI TUIs. */
export const COMMON_CHOICE_MENU_PATTERNS: RegExp[] = [
  /›.*enter to submit | esc to cancel/i,
  /\?.*\(Y\/n\)/i,
  /\([A-Z]\).* \([A-Z]\)/,
];

/** "esc to interrupt" busy footer. */
export const ESC_TO_INTERRUPT = /esc to interrupt/i;

/** Countdown cancel footer, e.g. "esc to cancel, 1m 30s". */
export const TIMED_CANCEL = /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i;

/** Animated Braille spinner glyphs (⠀-⣿). Transient — gone once a turn ends. */
export const BRAILLE_SPINNER = /[⠀-⣿]/;
