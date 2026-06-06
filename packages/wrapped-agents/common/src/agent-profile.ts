/**
 * AgentProfile — the (thin) per-CLI configuration surface.
 *
 * Everything that genuinely differs between the wrapped coding agents
 * (claude / codex / gemini / agy) lives here. The watchdog loop, server
 * bootstrap, session memory and PTY wrapper are all shared in `common` and
 * consume a profile, so adding a new agent means writing one of these — not
 * copying ~800 lines of watchdog logic.
 */

export type AgentType = 'claude' | 'codex' | 'gemini' | 'agy';

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

  /** Command sent to the worker to compact its context (e.g. '/compact'). */
  compactCommand: string;
}

// ---- Reusable detection presets ----
// Shared so the (currently identical) Claude-family agents don't each re-spell
// the same regexes. A profile can always override with its own patterns.

/** Choice-menu shapes common to the supported CLI TUIs. */
export const COMMON_CHOICE_MENU_PATTERNS: RegExp[] = [
  /›.*enter to submit | esc to cancel/i,
  /\?.*\(Y\/n\)/i,
  /\([A-Z]\).* \([A-Z]\)/,
];

const TIMED_CANCEL = /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i;

/** Claude-family (claude / agy / gemini-as-shipped) busy detection. */
export const CLAUDE_STYLE_SPINNER = /[✻✢○◎◯]|[⠀-⣿]/;
export const CLAUDE_STYLE_BUSY_PATTERNS: RegExp[] = [
  /esc to interrupt/i,
  TIMED_CANCEL,
  /\/btw to ask/i,
  /interrupting Claude/i,
];

/** Codex's leaner detection (Braille spinner + esc-to-interrupt/cancel only). */
export const CODEX_STYLE_SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
export const CODEX_STYLE_BUSY_PATTERNS: RegExp[] = [
  /esc to interrupt/i,
  TIMED_CANCEL,
];
