import * as fs from 'fs';
import * as path from 'path';
import { Agent } from './agent';
import { SessionMemory } from './session-memory';
import { SupervisorState, type AutonomyPolicy } from './supervisor-state';
import { generateSupervisorPrompt, type PromptContext, ActionPrompts } from './supervisor-prompts';
import { getState } from './state-machine-definition';
import type { AgentProfile } from './agent-profile';
import { readAgentViewportLines, WATCHDOG_PARSER_LINE_COUNT } from './terminal-view';

/**
 * Configurable timing constants and behavior flags
 *
 * - POST_ACTION_COOLDOWN: Cooldown after posting an action (default: 3000ms)
 * - WATCHDOG_INITIAL_WAIT: Initial wait time after posting before checking idle state (default: 2000ms)
 * - WATCHDOG_IDLE_CHECK_INTERVAL: Interval between idle state checks (default: 500ms)
 * - WATCHDOG_IDLE_DEBOUNCE: Debounce interval for idle detection (default: 100ms)
 * - WATCHDOG_MAX_RETRIES: Maximum retries for JSON parsing failures (default: 5)
 * - DEBUG_WATCHDOG: Enable verbose debug logging (default: false, set to 'true' to enable)
 */
const POST_ACTION_COOLDOWN = parseInt(process.env.WATCHDOG_POST_ACTION_COOLDOWN || '3000', 10);
const INITIAL_WAIT_AFTER_POST = parseInt(process.env.WATCHDOG_INITIAL_WAIT || '2000', 10);
const IDLE_CHECK_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_CHECK_INTERVAL || '500', 10);
const IDLE_DEBOUNCE_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_DEBOUNCE || '100', 10);
const MAX_RETRIES = parseInt(process.env.WATCHDOG_MAX_RETRIES || '5', 10);
const MAX_BUSY_TIMEOUT_MS = parseInt(process.env.WATCHDOG_MAX_BUSY_TIMEOUT || '300000', 10); // 5 minutes
// After an ERROR stops the loop, auto-restart it from EXPLORING this long later
// so an unattended session recovers itself instead of sitting stopped until a
// human re-enables it. Runs in the backend session process (setInterval-driven,
// independent of the web UI) and is bounded by the session lease. <=0 disables.
const AUTO_RETRY_AFTER_ERROR_MS = parseInt(process.env.WATCHDOG_AUTO_RETRY_MS || '600000', 10); // 10 minutes
// Cap on consecutive post-emergency (quota / usage-limit / model-switch)
// auto-retries before the loop gives up and stays stopped. <=0 (default) means
// unbounded: a usage-limit hit should recover on its own once the quota window
// rolls over, so by default an unattended session retries indefinitely. Set >0
// as a safety valve when a *model downgrade* would otherwise retry forever on
// the wrong model. Reset by a manual restart. Read at retry time so it can be
// changed (or set in a test) without restarting the process.
const maxEmergencyRetries = () => parseInt(process.env.WATCHDOG_MAX_EMERGENCY_RETRIES || '0', 10);
const MAX_WATCHDOG_TIMEOUT_MS = parseInt(process.env.WATCHDOG_MAX_WATCHDOG_TIMEOUT || '120000', 10); // 2 minutes
// Prompts get typed into the agent PTYs in chunks rather than one char at a
// time: the supervisor prompt is ~1.5k chars, so the old 50ms-per-char pacing
// took over a minute to send (and made "stop" feel unresponsive). Chunked
// pacing sends the same text in well under a second.
const POST_CHUNK_SIZE = parseInt(process.env.WATCHDOG_POST_CHUNK_SIZE || '40', 10);
const POST_CHUNK_DELAY = parseInt(process.env.WATCHDOG_POST_CHUNK_DELAY || '8', 10);
const DEBUG_WATCHDOG = process.env.DEBUG_WATCHDOG === 'true';

const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";

// Prefixed to every guidance message the supervisor posts to the worker, so the
// worker knows who is steering it and that the supervisor itself is editable.
const WORKER_SUPERVISOR_PREFIX = "I am your supervisor AI agent. you can improve me in the wrapped agents <claude/gemini/...> package.";

const RESPONSE_START_TIMEOUT_MS = 15000;
const RESPONSE_COMPLETION_GRACE_MS = 2000;
const WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS = 20000;
// How long the worker's bottom region must be BOTH free of an activity
// indicator AND unchanged before we treat it as idle. The spinner line carries
// a live elapsed-time/token counter that ticks ~1/s while the agent works, so a
// changing screen means "still working" even on frames where we fail to match
// the (animated) spinner glyph or rotating tip. Must comfortably exceed the
// ~1s counter cadence so between-tick stillness isn't mistaken for idle.
const WORKER_IDLE_STABILITY_MS = parseInt(process.env.WATCHDOG_WORKER_IDLE_STABILITY || '6500', 10);

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * Collapse all runs of whitespace (incl. newlines) to single spaces. Used both
 * for the worker context capture and the supervisor marker match: the TUI may
 * hard-wrap and indent a logically-single line, so exact substring matching only
 * works after normalization.
 */
function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Strip Ink/Grok TUI chrome that gets spliced into hard-wrapped lines: right-
 * margin block fillers (█), per-line timestamps, and box-drawing glyphs. Left
 * intact otherwise — we only remove artifacts that corrupt JSON extraction.
 */
function cleanTuiArtifacts(str: string): string {
  return str
    .replace(/\s*█+\s*/g, ' ')
    .replace(/\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, ' ')
    .replace(/[╭╮╯╰─│┃┏┓┗┛├┤┬┴┼]/g, ' ');
}

/**
 * Extract a balanced `{...}` object starting at `start`, respecting quoted
 * strings so `{` / `}` inside JSON string values (e.g. prose mentioning
 * `{\"action\"}`) do not confuse depth counting.
 */
function extractBalancedJsonObject(text: string, start: number): string | null {
  if (start < 0 || text[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let quote = '';

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }

  return null;
}

function prepareScreenForJsonExtraction(rawScreen: string): string {
  const plain = stripAnsi(rawScreen).replace(/```(?:json)?/gi, '').replace(/```/g, '');
  return normalizeWhitespace(cleanTuiArtifacts(plain));
}

interface WorkerActivityState {
  enabledAt: number;
  observedBusySinceEnabled: boolean;
  lastBusyAt: number;
  lastSnapshot: string;
  lastSnapshotAt: number;
}

interface SnapshotState {
  lastSnapshot: string;
  lastSnapshotAt: number;
}

interface AgentView {
  recent8: string;
  recent12: string;
  recent24: string;
  recent30: string;
  recent40: string;
  recent50: string;
}

interface AgentSignals {
  view: AgentView;
  hasChoiceMenu: boolean;
  isGenerating: boolean;
  hasAuthoritativeBusySignal: boolean;
}

export class WatchdogService {
  worker!: Agent;
  watchdog!: Agent;

  enabled: boolean = false;
  waitingForResponse: boolean = false;
  waitingForResponseStart: boolean = false;
  processing: boolean = false;
  retryCount: number = 0;
  // How many times the post-emergency (quota / usage-limit / model-switch)
  // auto-retry has fired without an intervening manual restart. Surfaces "the
  // session recovered from N usage-limit hits overnight" and feeds the optional
  // MAX_EMERGENCY_RETRIES cap. Reset on a manual enable, not on an auto-retry.
  emergencyRetryCount: number = 0;

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;
  autonomyPolicy: AutonomyPolicy;

  private nextCheckTime = 0;
  private errorRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  // True only while the auto-retry timer is calling setEnabled(true), so the
  // manual-restart path can reset emergencyRetryCount while the auto path keeps
  // accumulating it across the unattended stretch.
  private autoRetrying = false;
  private busyStartedAt = 0;
  // Worker screen snapshot used to tell "working" (screen changing) from
  // "frozen" (screen static) for the busy-timeout. See the busy branch in tick().
  private lastBusyWorkerView = '';
  private watchdogBusyStartedAt = 0;
  private responseRequestedAt = 0;
  private responseSawGenerating = false;
  private currentPromptMarker: string = PROMPT_MARKER;
  private lastExecutedActionSignature = '';
  private lastExecutedActionAt = 0;
  private lastLongProcessingEscalationAt = 0;
  private watchdogSnapshotState: SnapshotState = {
    lastSnapshot: '',
    lastSnapshotAt: 0,
  };
  private workerActivity: WorkerActivityState = {
    enabledAt: 0,
    observedBusySinceEnabled: false,
    lastBusyAt: 0,
    lastSnapshot: '',
    lastSnapshotAt: 0,
  };
  private sessionMemory: SessionMemory | null = null;

  /**
   * Timestamp of last "main worker halted" signal received from an external
   * hook (configured in the CLI). This provides a reliable out-of-band
   * notification that the worker TUI has finished a turn and is idle, bypassing
   * brittle screen-scraping for agents whose output format makes spinner/busy
   * detection unreliable (e.g. grok).
   */
  private lastExternalHaltAt = 0;
  private baseInstructText: string = '';
  private instructTextWithMemory: string = '';
  // The full INSTRUCT guide is heavy (~7KB). The worker is a continuous session,
  // so it only needs the guide once per context epoch — sent on the first
  // start_work, then re-armed after a worker /compact wipes its context.
  // Subsequent start_works send only the short "check Aimparency" pointer.
  private instructSent = false;
  private workingTowardsCommit = false;
  private supervisorState: SupervisorState = new SupervisorState();
  private projectPath?: string;
  readonly profile: AgentProfile;

  constructor(
    worker: Agent,
    watchdog: Agent,
    profile: AgentProfile,
    opts: {
      expectedModel?: string;
      compactEvery?: number;
      projectPath?: string;
      autonomyPolicy?: AutonomyPolicy;
      instructText?: string;
    } = {}
  ) {
    this.worker = worker;
    this.watchdog = watchdog;
    this.profile = profile;
    this.expectedModel = opts.expectedModel;
    this.compactEvery = opts.compactEvery ?? 1;
    this.autonomyPolicy = opts.autonomyPolicy ?? {};
    this.projectPath = opts.projectPath;
    this.baseInstructText = opts.instructText ?? '';
    this.instructTextWithMemory = this.baseInstructText;

    // Initialize session memory if projectPath provided
    if (this.projectPath) {
      this.sessionMemory = new SessionMemory(this.projectPath);
      this.loadSessionMemoryContext(this.projectPath);
    }
  }

  /**
   * Load recent session memories and inject into instruction context
   */
  private async loadSessionMemoryContext(projectPath: string) {
    try {
      const summaries = await SessionMemory.loadRecentSummaries(projectPath, 5);
      // Real, structured limitation data from the durable ERROR log — surfaced
      // alongside the session insights so the next run can target its own
      // recurring failures (recursive self-improvement) instead of rediscovering
      // them. Best-effort: returns '' when there is nothing to report.
      const friction = await SessionMemory.summarizeRecentFriction();

      const blocks: string[] = [this.baseInstructText];
      if (summaries.length > 0) blocks.push(SessionMemory.formatForContext(summaries));
      if (friction) blocks.push(friction);

      this.instructTextWithMemory = blocks.join('\n\n');
      this.log(
        `Loaded ${summaries.length} session memories${friction ? ' + system-friction summary' : ''} into context`
      );
    } catch (error) {
      this.log(`Failed to load session memory context: ${error}`);
      this.instructTextWithMemory = this.baseInstructText;
    }
  }

  private log(msg: string) {
    // Only log DEBUG messages when DEBUG_WATCHDOG is enabled
    if (msg.startsWith('DEBUG:') && !DEBUG_WATCHDOG) {
      return;
    }
    console.log(`[${new Date().toISOString()}] [WatchdogService] ${msg}`);
  }

  emergencyStopped: boolean = false;
  lastStopReason = '';
  onEmergencyStop?: () => void;
  onStop?: (reason: string) => void;
  onStateChange?: () => void;
  onCommStatusChange?: (status: string) => void;
  private lastCommStatus = '';
  /** Which agent we're actively typing a message into, if any. */
  private isPosting: 'worker' | 'watchdog' | null = null;

  /**
   * Human-readable description of the current supervisor↔agent communication
   * phase. Only meaningful while the automation is enabled; '' otherwise.
   */
  getCommStatus(): string {
    if (!this.enabled) return '';
    if (this.isPosting === 'watchdog') return 'sending message to supervisor';
    if (this.isPosting === 'worker') return 'sending message to main agent';
    if (this.waitingForResponseStart || this.waitingForResponse) return 'waiting for supervisor reply';
    return 'waiting for main agent halt';
  }

  private emitCommStatusIfChanged() {
    const status = this.getCommStatus();
    if (status === this.lastCommStatus) return;
    this.lastCommStatus = status;
    this.onCommStatusChange?.(status);
  }

  setEnabled(enabled: boolean) {
    // Any explicit enable/disable supersedes a pending post-error auto-retry.
    this.clearAutoRetry();
    this.enabled = enabled;
    if (enabled) {
      this.emergencyStopped = false;
      // A manual restart is a clean slate: forget the emergency-retry tally so a
      // future quota hit starts counting from zero against the cap. An auto
      // retry must NOT reset it, or the cap could never be reached.
      if (!this.autoRetrying) this.emergencyRetryCount = 0;
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.processing = false;
      this.nextCheckTime = Date.now() + 500;
      this.turnCount = 0;
      this.workingTowardsCommit = false;
      this.workerActivity.enabledAt = Date.now();
      this.busyStartedAt = 0;
      this.watchdogBusyStartedAt = 0;
      this.lastStopReason = '';
      this.instructSent = false;
      // Clear retry bookkeeping too: after a max-retries ERROR->stop, re-enabling
      // must start fresh rather than land at the retry ceiling immediately.
      this.retryCount = 0;
      // Enabling is a fresh start: clear any stuck ERROR/backoff state so the
      // operator's "automate" toggle actually restarts the loop from EXPLORING
      // rather than resuming a wedged ERROR machine.
      this.supervisorState.reset();
    } else {
      this.waitingForResponse = false;
      this.processing = false;
      this.isPosting = null;
      this.lastStopReason = '';
    }
    this.log(`Logic ${enabled ? 'ENABLED' : 'DISABLED'}`);
    this.emitCommStatusIfChanged();
    this.onStateChange?.();
  }

  stop(reason: string) {
    if (!this.enabled) return;
    this.enabled = false;
    this.waitingForResponse = false;
    this.processing = false;
    this.lastStopReason = reason;
    this.log(`WATCHDOG STOPPED: ${reason}`);
    if (this.onStop) {
      this.onStop(reason);
    }
    this.onStateChange?.();
  }

  /**
   * Called when the main worker CLI signals (via configured hook) that it has
   * halted / finished its turn. Forces the idle detection so the supervisor
   * loop can escalate reliably even if the TUI output does not match our
   * spinner/busy patterns.
   */
  signalWorkerHalted() {
    const now = Date.now();
    this.lastExternalHaltAt = now;
    this.log('Received external halt signal for main worker (hook)');
    // Force the busy tracker into "idle" so getWorkerIdleEscalationReason fires.
    this.advanceWorkerBusyTimeout(true, '', now);
    this.workerActivity.lastSnapshot = '';
    this.workerActivity.lastSnapshotAt = now;
    // Wake tick() on next opportunity.
    this.nextCheckTime = now;
    this.onStateChange?.();
  }

  /**
   * Enter the ERROR state and stop the supervisor loop, then schedule an
   * automatic retry. Stopping flips the UI button to "automate" and gives a
   * clean state; the auto-retry (default 10 min, AUTO_RETRY_AFTER_ERROR_MS)
   * then re-enables a fresh EXPLORING run so an unattended session recovers
   * itself instead of sitting in ERROR until a human returns. The timer lives
   * in the backend session process (independent of the web UI) and dies with
   * the process at lease expiry. A manual enable/disable cancels it.
   */
  private enterError(reason: string) {
    this.supervisorState.triggerError(reason);
    this.logErrorDiagnostics(reason);
    this.stop(`Supervisor error: ${reason}`);
    this.scheduleAutoRetry();
  }

  private clearAutoRetry() {
    if (this.errorRetryTimeout) {
      clearTimeout(this.errorRetryTimeout);
      this.errorRetryTimeout = null;
    }
  }

  private scheduleAutoRetry() {
    if (AUTO_RETRY_AFTER_ERROR_MS <= 0) return; // disabled via env
    this.clearAutoRetry();
    this.log(`Auto-retry scheduled in ${Math.round(AUTO_RETRY_AFTER_ERROR_MS / 60000)} min (fresh EXPLORING restart).`);
    this.errorRetryTimeout = setTimeout(() => {
      this.errorRetryTimeout = null;
      // Skip only if the operator already restarted manually. An active
      // emergency stop (quota limit / model switch) must NOT block the retry —
      // a usage-limit hit should recover on its own once the quota window rolls
      // over, so we retry despite it. setEnabled(true) clears emergencyStopped.
      // If the limit is still in force the supervisor will re-trigger the
      // emergency stop, which reschedules this retry: effectively a retry every
      // AUTO_RETRY_AFTER_ERROR_MS until the quota frees up.
      if (this.enabled) return;

      // emergencyStopped is still set here (only setEnabled clears it), so it
      // tells an emergency retry apart from an ordinary-error retry.
      if (this.emergencyStopped) {
        const cap = maxEmergencyRetries();
        this.emergencyRetryCount++;
        if (cap > 0 && this.emergencyRetryCount > cap) {
          this.log(`Auto-retry: giving up after ${cap} emergency (quota/model-switch) retries — staying stopped until a manual restart.`);
          return;
        }
        this.log(`Auto-retry: re-enabling after emergency stop (quota recovery attempt #${this.emergencyRetryCount}).`);
      } else {
        this.log('Auto-retry: re-enabling supervisor after error.');
      }

      this.autoRetrying = true;
      this.setEnabled(true);
      this.autoRetrying = false;
    }, AUTO_RETRY_AFTER_ERROR_MS);
  }

  /**
   * Capture everything needed to diagnose an ERROR-state entry after the fact.
   * Writes both a human-readable block to stdout (captured per-session in
   * logs/<port>/out.log) and a durable one-line JSON record to the
   * cross-session log logs/supervisor-errors.log. The record bundles the
   * trigger reason, state-machine context (previous state, error count,
   * backoff), the work in flight, the last few transitions, and the tail of
   * both the worker and watchdog terminals — i.e. why the supervisor said
   * state:error. Best-effort: never throws into the supervisor loop.
   */
  private logErrorDiagnostics(reason: string) {
    const ctx = this.supervisorState.getContext();
    const recentTransitions = this.supervisorState.getHistory().slice(-10).map(t => ({
      from: t.from,
      to: t.to,
      action: t.action,
      at: new Date(t.timestamp).toISOString(),
    }));

    let workerTail = '';
    let watchdogTail = '';
    try { workerTail = this.worker?.getLines(40) ?? ''; } catch { /* terminal unavailable */ }
    try { watchdogTail = this.watchdog?.getLines(40) ?? ''; } catch { /* terminal unavailable */ }

    const record = {
      timestamp: new Date().toISOString(),
      event: 'SUPERVISOR_ERROR_STATE',
      agent: this.profile?.bannerName,
      expectedModel: this.expectedModel,
      projectPath: this.projectPath,
      reason,
      state: 'ERROR' as const,
      previousState: ctx.previousState,
      errorCount: ctx.errorCount,
      backoffMs: this.supervisorState.getErrorBackoffDelay(),
      work: { aimText: ctx.aimText, task: ctx.task, strategy: ctx.strategy },
      recentTransitions,
      workerTail,
      watchdogTail,
    };

    // 1. Human-readable block — lands in the per-session out.log via stdout.
    this.log(
      `\n===== SUPERVISOR ENTERED ERROR STATE =====\n` +
      `reason: ${reason}\n` +
      `previousState: ${record.previousState ?? 'n/a'} | errorCount: ${record.errorCount} | backoff: ${Math.round(record.backoffMs / 1000)}s\n` +
      `aim/task: ${record.work.aimText ?? record.work.task ?? 'n/a'}\n` +
      `recent transitions: ${recentTransitions.map(h => `${h.from}->${h.to}(${h.action})`).join(' , ') || '(none)'}\n` +
      `--- worker terminal tail ---\n${workerTail || '(empty)'}\n` +
      `--- watchdog terminal tail ---\n${watchdogTail || '(empty)'}\n` +
      `===========================================`
    );

    // 2. Durable cross-session JSONL record for easy after-the-fact lookup.
    try {
      const logDir = SessionMemory.getErrorLogDir();
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'supervisor-errors.log'), JSON.stringify(record) + '\n');
    } catch (e) {
      this.log(`Failed to write supervisor-errors.log: ${e}`);
    }
  }

  triggerEmergencyStop() {
    if (this.emergencyStopped) return;
    this.emergencyStopped = true;
    this.stop("Quota limit / model switch detected");
    if (this.onEmergencyStop) {
      this.onEmergencyStop();
    }
    // A quota/usage-limit hit is transient — the window rolls over. Schedule the
    // same auto-retry used for ordinary errors so an unattended session resumes
    // itself instead of sitting stopped until a human returns. A manual
    // enable/disable cancels it (setEnabled -> clearAutoRetry).
    this.scheduleAutoRetry();
    this.onStateChange?.();
  }

  getSupervisorStateInfo() {
      const stateName = this.supervisorState.getState();
      const stateDefinition = getState(stateName);
      return {
          state: stateName,
          color: stateDefinition?.color ?? '#cccccc'
      };
  }

  async tick() {
    if (!this.enabled || this.processing) return;

    const now = Date.now();
    if (now < this.nextCheckTime) {
      this.emitCommStatusIfChanged();
      return;
    }

    this.processing = true;

    try {
      const watchdogSignals = this.captureAgentSignals(this.watchdog, true);

      // 1. Handle "Waiting for response to START"
      if (this.waitingForResponseStart) {
        if (watchdogSignals.isGenerating) {
          this.log("DEBUG: Watchdog started generating.");
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.responseSawGenerating = true;
          this.resetWatchdogSnapshotState();
          this.nextCheckTime = now + IDLE_CHECK_INTERVAL;
          return;
        }

        // Fast-responder safety net: a quick watchdog (e.g. Haiku) can produce
        // its whole reply inside INITIAL_WAIT_AFTER_POST, so we may never catch
        // the live spinner and would otherwise wait out the full start-timeout
        // and bogusly "retry" a reply that is already on screen. If a COMPLETE,
        // parseable action is already present after the marker, process it now.
        // We validate the JSON locally first so a half-rendered reply doesn't
        // trip processDecision's retry path.
        let earlyContent = this.locateResponseAfterMarker(
          this.readAgentLines(this.watchdog, WATCHDOG_PARSER_LINE_COUNT),
          this.currentPromptMarker,
        );
        if (earlyContent) {
          try {
            let jsonString = earlyContent;
            if (!earlyContent.trim().startsWith('{')) {
              jsonString = this.extractJson(earlyContent);
            }
            JSON.parse(jsonString.replace(/[\r\n]+/g, ' '));
            this.log("DEBUG: Watchdog reply already on screen before spinner seen. Parsing early.");
            this.waitingForResponseStart = false;
            await this.processDecision(jsonString);
            return;
          } catch {
            // Not a complete/valid action yet — keep waiting for it to finish.
          }
        }

        const elapsedSinceRequest = now - this.responseRequestedAt;
        if (elapsedSinceRequest > RESPONSE_START_TIMEOUT_MS) {
          this.log(`DEBUG: Watchdog failed to start response within ${RESPONSE_START_TIMEOUT_MS}ms. Retrying.`);
          await this.retry("Watchdog failed to start responding");
          return;
        }

        this.nextCheckTime = now + IDLE_CHECK_INTERVAL;
        return;
      }

      // 2. Handle "Waiting for response to COMPLETE"
      if (this.waitingForResponse) {
        const watchdogEffectivelyGenerating = this.isWatchdogEffectivelyGenerating(watchdogSignals, now);

        const elapsedSinceRequest = now - this.responseRequestedAt;

        if (elapsedSinceRequest > 120000) {
          this.log(`DEBUG: Supervisor failed to produce usable reply within 120s. Retrying.`);
          await this.retry("Supervisor reply timeout");
          return;
        }

        if (elapsedSinceRequest < RESPONSE_COMPLETION_GRACE_MS) {
          this.log(`DEBUG: Deferring response completion check (${elapsedSinceRequest}ms < ${RESPONSE_COMPLETION_GRACE_MS}ms grace).`);
          this.nextCheckTime = now + 1000;
          return;
        }

        // Try to parse even if our "generating" heuristic still thinks it's busy.
        // Many TUIs keep some updating element (clock, cursor area, etc.) which
        // can make the screen delta never fully settle. If the user says the
        // response is on screen and looks correct, we should still attempt extraction.
        this.log("Attempting to parse supervisor response (past grace)...");
        const watchdogTail = this.readAgentLines(this.watchdog, WATCHDOG_PARSER_LINE_COUNT);
        let contentToParse = this.locateResponseAfterMarker(
          watchdogTail,
          this.currentPromptMarker,
        );

        if (contentToParse) {
          try {
            let jsonString = contentToParse;
            if (!contentToParse.trim().startsWith('{')) {
              jsonString = this.extractJson(contentToParse);
            }
            await this.processDecision(jsonString);
          } catch (e: any) {
            this.log(`DEBUG: JSON extraction/parsing failed: ${e.message}`);
            await this.retry(e.message || "JSON extraction failed");
          }
          return;
        }

        // Extra debug: show what the tail actually looks like when we can't find it
        this.log(`DEBUG: No parsable content after marker. Tail (normalized, last 300 chars): ${normalizeWhitespace(watchdogTail).slice(-300)}`);

        // If we didn't find anything yet, only keep waiting if we still think it's generating.
        if (watchdogEffectivelyGenerating) {
          this.nextCheckTime = now + IDLE_CHECK_INTERVAL;
          return;
        }

        this.log("DEBUG: Response marker not found or content empty. Waiting...");
        this.nextCheckTime = now + 1000;
        return;
      }

      // 3. Monitor Worker Activity and Escalate if Idle
      const workerSignals = this.captureAgentSignals(this.worker, false);
      const workerIdleReason = this.getWorkerIdleEscalationReason(now, workerSignals);

      if (workerIdleReason) {
        // Worker is idle → not continuously busy; reset the busy timer.
        this.advanceWorkerBusyTimeout(true, '', now);
        this.log(`Escalating to Watchdog: ${workerIdleReason}`);
        this.markWorkerIdleEscalation(now, workerSignals);

        if (this.turnCount >= this.compactEvery) {
          this.log(`Turn count ${this.turnCount} reached limit ${this.compactEvery}. Compacting watchdog context.`);
          this.turnCount = 0;
          await this.post(this.watchdog, this.profile.compactCommand);
          this.nextCheckTime = now + INITIAL_WAIT_AFTER_POST;
        } else {
          await this.askWatchdog();
        }
      } else {
        const { frozen, frozenForMs } = this.advanceWorkerBusyTimeout(
          false, workerSignals.view.recent24, now,
        );
        if (frozen) {
          this.log(`Worker busy with a static screen for ${Math.floor(frozenForMs/1000)}s (limit: ${MAX_BUSY_TIMEOUT_MS/1000}s). Triggering ERROR.`);
          this.busyStartedAt = 0;
          this.enterError(`Worker session frozen (no screen change for ${Math.floor(frozenForMs/1000)}s while busy)`);
          this.processing = false;
          return;
        }
        this.nextCheckTime = now + IDLE_CHECK_INTERVAL;
      }

    } catch (e) {
      console.error('[WatchdogService] Error in tick:', e);
    } finally {
      this.processing = false;
      this.emitCommStatusIfChanged();
    }
  }

  private resetWatchdogSnapshotState() {
    this.watchdogSnapshotState = {
      lastSnapshot: '',
      lastSnapshotAt: 0,
    };
  }

  /**
   * Shared "is this agent still actively generating?" detector for both the
   * worker and the supervisor. Two combined signals:
   *  1. An explicit activity indicator (spinner line / busy footer) via the
   *     profile — fast and authoritative when it matches.
   *  2. A "screen is changing" backstop: the spinner line's elapsed-time/token
   *     counter ticks ~1/s while an agent works, so a changing region means
   *     "still working" even on frames where the (animated) glyph or rotating
   *     tip didn't match. Only a region that is BOTH indicator-free AND unchanged
   *     for `stabilityMs` counts as settled/idle.
   * The only intended per-agent difference is the view window and how long the
   * screen must hold still — passed in by the callers below.
   */
  private isAgentEffectivelyBusy(
    signals: AgentSignals,
    now: number,
    snapshotState: SnapshotState,
    viewKey: keyof AgentView,
    stabilityMs: number,
  ): boolean {
    const view = signals.view[viewKey];

    if (signals.isGenerating || snapshotState.lastSnapshotAt === 0 || snapshotState.lastSnapshot !== view) {
      snapshotState.lastSnapshot = view;
      snapshotState.lastSnapshotAt = now;
      return true;
    }

    return now - snapshotState.lastSnapshotAt < stabilityMs;
  }

  private isWatchdogEffectivelyGenerating(signals: AgentSignals, now: number): boolean {
    // Grok and similar TUIs keep a live status bar (% / tokens) that changes
    // every frame; a completed-turn footer is a stronger idle signal than the
    // screen-delta backstop, so don't block reply parsing on a ticking footer.
    if (!signals.isGenerating) return false;

    const stabilityMs = this.profile.watchdogIdleStabilityMs ?? IDLE_DEBOUNCE_INTERVAL;
    return this.isAgentEffectivelyBusy(signals, now, this.watchdogSnapshotState, 'recent8', stabilityMs);
  }

  /**
   * Worker-specific wrapper around {@link isAgentEffectivelyBusy}: uses a wider
   * view and a much longer stability window (the worker runs long tasks), and
   * additionally records `observedBusySinceEnabled` so a worker that is static
   * from the start still waits out the bootstrap grace rather than escalating on
   * the first render diff.
   */
  private isWorkerEffectivelyBusy(signals: AgentSignals, now: number): boolean {
    const busy = this.isAgentEffectivelyBusy(
      signals, now, this.workerActivity, 'recent12', WORKER_IDLE_STABILITY_MS,
    );
    if (signals.isGenerating) {
      this.workerActivity.observedBusySinceEnabled = true;
      this.workerActivity.lastBusyAt = now;
    }
    return busy;
  }

  /**
   * Advance the worker busy-timeout for one tick and report whether the worker
   * is frozen. The timeout must tell "wedged" from "working hard" — duration
   * alone can't, since a capable agent works minutes nonstop. So:
   *   - idle worker → reset (not continuously busy). Fixes the false trip on an
   *     idle session, where the timer used to accrue wall-clock-since-enable.
   *   - first busy tick, or the screen changed since last tick (output / the
   *     spinner's ticking timer = observable progress) → (re)anchor the timer.
   *   - busy with an unchanged screen → accumulate; frozen once it exceeds the
   *     cap. Only a worker stuck busy with a COMPLETELY STATIC screen for the
   *     whole window is reported frozen.
   * Extracted from tick() so the two failure modes are unit-testable.
   */
  private advanceWorkerBusyTimeout(
    isWorkerIdle: boolean,
    workerView: string,
    now: number,
  ): { frozen: boolean; frozenForMs: number } {
    if (isWorkerIdle) {
      this.busyStartedAt = 0;
      return { frozen: false, frozenForMs: 0 };
    }
    if (this.busyStartedAt === 0 || workerView !== this.lastBusyWorkerView) {
      this.busyStartedAt = now;
      this.lastBusyWorkerView = workerView;
      return { frozen: false, frozenForMs: 0 };
    }
    const frozenForMs = now - this.busyStartedAt;
    return { frozen: frozenForMs > MAX_BUSY_TIMEOUT_MS, frozenForMs };
  }

  private getWorkerIdleEscalationReason(now: number, signals: AgentSignals): string | null {
    // External hook signal takes precedence for agents with unreliable TUI output.
    if (this.lastExternalHaltAt > 0 && (now - this.lastExternalHaltAt) < 30000) {
      const reason = 'Worker halted (external hook signal)';
      this.lastExternalHaltAt = 0; // consume the signal
      return reason;
    }

    if (this.isWorkerEffectivelyBusy(signals, now)) return null;

    if (this.workerActivity.observedBusySinceEnabled) {
      return 'Worker idle: no activity indicator and screen static. Asking watchdog.';
    }

    if (this.workerActivity.enabledAt !== 0 && now - this.workerActivity.enabledAt >= WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS) {
      return `Worker never showed a busy indicator after enable; bootstrap timeout ${WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS}ms reached. Asking watchdog.`;
    }

    return null;
  }

  /** Restart the stability window after escalating so we don't re-escalate the
   *  same idle screen before the supervisor's action has a chance to land. */
  private markWorkerIdleEscalation(now: number, signals: AgentSignals) {
    this.workerActivity.lastSnapshot = signals.view.recent12;
    this.workerActivity.lastSnapshotAt = now;
  }

  private hasVisibleChoiceMenu(agent: Agent): boolean {
    return this.captureAgentSignals(agent, true).hasChoiceMenu;
  }

  private readAgentLines(agent: Agent, count: number): string {
    return readAgentViewportLines(agent, count);
  }

  private captureAgentView(agent: Agent): AgentView {
    return {
      recent8: stripAnsi(this.readAgentLines(agent, 8)),
      recent12: stripAnsi(this.readAgentLines(agent, 12)),
      recent24: stripAnsi(this.readAgentLines(agent, 24)),
      recent30: stripAnsi(this.readAgentLines(agent, 30)),
      recent40: stripAnsi(this.readAgentLines(agent, 40)),
      recent50: stripAnsi(this.readAgentLines(agent, 50)),
    };
  }

  private captureAgentSignals(agent: Agent, checkMarker: boolean): AgentSignals {
    const view = this.captureAgentView(agent);

    // Choice-menu detection is per-agent (CLI TUIs differ) via the profile.
    const hasChoiceMenu = this.profile.choiceMenuPatterns.some(p => p.test(view.recent8));
    const isGenerating = this.detectGenerating(view, hasChoiceMenu);

    return {
      view,
      hasChoiceMenu,
      isGenerating,
      hasAuthoritativeBusySignal: isGenerating,
    };
  }

  private detectGenerating(view: AgentView, hasChoiceMenu: boolean): boolean {
    if (hasChoiceMenu) return false;

    // A completed-turn footer (e.g. Grok's "Turn completed in 13s.") means the
    // agent is idle even if a status bar or cursor keeps ticking frame-to-frame.
    if (this.profile.idleFooterPatterns?.some(p => p.test(view.recent12))) {
      return false;
    }

    // Spinner glyphs and busy footers are per-agent (CLI TUIs differ) via the
    // profile. Use a slightly taller window than the choice-menu check: the
    // spinner status line sits above the rotating tip + input box, so it can be
    // ~6-7 lines from the bottom.
    if (this.profile.spinnerPattern.test(view.recent12)) return true;
    return this.profile.busyPatterns.some(p => p.test(view.recent12));
  }

  async wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async ensureEnter(agent: Agent) {
    agent.write('\r');
    await this.wait(100);
    agent.write('\r');
  }

  async post(agent: Agent, text: string) {
    const target: 'worker' | 'watchdog' = agent === this.worker ? 'worker' : 'watchdog';
    // Prefix only natural-language guidance, not slash commands like /compact
    // (a prefixed command would no longer be recognized by the worker CLI).
    if (target === 'worker' && !text.startsWith('/')) {
      text = `${WORKER_SUPERVISOR_PREFIX}\n\n${text}`;
    }
    this.log(`Posting to ${target === 'worker' ? 'Worker' : 'Watchdog'}: ${text.substring(0, 50)}...`);

    this.isPosting = target;
    this.emitCommStatusIfChanged();

    try {
      // Type in chunks rather than one char at a time (see POST_CHUNK_SIZE).
      for (let i = 0; i < text.length; i += POST_CHUNK_SIZE) {
        // Bail immediately if the watchdog was disabled mid-message, so "stop"
        // doesn't have to wait out a long in-flight prompt. The partial input is
        // left unsubmitted (no trailing Enter).
        if (!this.enabled) {
          this.log("Posting aborted: watchdog disabled mid-message.");
          return;
        }
        agent.write(text.slice(i, i + POST_CHUNK_SIZE));
        await this.wait(POST_CHUNK_DELAY);
      }

      // Send enter to submit
      await this.wait(100);
      agent.write('\r');
      await this.wait(100);
      this.log("Post complete.");
    } finally {
      this.isPosting = null;
      this.emitCommStatusIfChanged();
    }
  }

  async onWorkerData(data: string) {
      if (!this.enabled) return;
  }

  isGenerating(agent: Agent): boolean {
    const view = this.captureAgentSignals(agent, false);
    return view.isGenerating;
  }

  async askWatchdog() {
    this.log("Asking Watchdog for guidance (STATE MACHINE)...");

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot ask watchdog: agents not initialized");
      return;
    }

    this.waitingForResponseStart = true;
    this.waitingForResponse = false;
    this.retryCount = 0;
    this.responseRequestedAt = Date.now();
    this.responseSawGenerating = false;
    this.resetWatchdogSnapshotState();
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;

    const workerSignals = this.captureAgentSignals(this.worker, false);
    const supervisedContext = normalizeWhitespace(workerSignals.view.recent50);

    // Get current state
    const currentState = this.supervisorState.getState();
    const stateContext = this.supervisorState.getContext();

    this.log(`[StateMachine] Current state: ${currentState}`);
    this.log(`DEBUG: Worker context length: ${supervisedContext.length} chars`);

    // Build prompt context
    const promptContext: PromptContext = {
      state: currentState,
      supervisedContext,
      supervisedStatus: workerSignals.isGenerating ? 'busy' : 'idle',
      requiresInput: workerSignals.hasChoiceMenu,
      autonomyPolicy: this.autonomyPolicy
    };

    // Add state-specific context
    if (currentState === 'WORKING' || currentState === 'WRAPPING_UP') {
      promptContext.aimText = stateContext.aimText;
      const workDuration = this.supervisorState.getWorkDuration();
      if (workDuration !== null) {
        const minutes = Math.floor(workDuration / 60000);
        const seconds = Math.floor((workDuration % 60000) / 1000);
        promptContext.workDuration = `${minutes}m ${seconds}s`;
      }
    }

    // Generate request ID and prompt using state machine
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const question = generateSupervisorPrompt(promptContext, requestId);
    // Use a short prefix that the supervisor AI itself will output at the start of its reply.
    // This is much more reliable than searching for our long prompt text (which can scroll
    // out of the TUI buffer). We instruct the model to start its output with it.
    this.currentPromptMarker = `<<SUPERVISOR_JSON:${requestId}>>`;

    this.log(`[StateMachine] Generated ${currentState} prompt, length: ${question.length} chars`);
    this.log(`DEBUG: Question (first 500 chars):\n${question.substring(0, 500)}`);

    // Post the state-based question
    await this.post(this.watchdog, question);

    // Capture screen AFTER posting
    await this.wait(500);
    const screenAfter = this.readAgentLines(this.watchdog, 100);
    this.log(`DEBUG: Watchdog screen AFTER post (last 500 chars):\n${screenAfter.substring(Math.max(0, screenAfter.length - 500))}`);
  }

  async processDecision(jsonString: string) {
    this.waitingForResponse = false;
    this.log(`Processing decision JSON length: ${jsonString.length}`);

    try {
      this.log(`Parsing JSON: ${jsonString}`);
      jsonString = jsonString.replace(/[\r\n]+/g, ' ');
      const decision = JSON.parse(jsonString);

      if (decision.action) {
         const result = this.supervisorState.attemptAction(decision.action);

         if (result.success) {
           this.log(`[StateMachine] Executing ${decision.action.type} → ${result.newState}`);
           await this.executeActionSideEffects(decision.action);
           this.onStateChange?.();
         } else if (result.backoffActive) {
           this.log(`[StateMachine] Action rejected: ${result.error}`);
         } else {
           this.log(`[StateMachine] Invalid action: ${result.error}`);
           await this.urgeSupervisorToStickToAvailableActions(
             decision.action.type,
             result.validActions || []
           );
         }
      }
    } catch (e: any) {
      this.log(`Error parsing JSON decision: ${e.message}`);
      await this.retry(e.message);
    }
  }

  /**
   * Locate the supervisor's reply after our response prefix on the watchdog screen.
   * We now instruct the AI to *emit* the prefix at the very start of its reply
   * (e.g. <<SUPERVISOR_JSON:abc123>>{"action":...}).
   * This is far more reliable than searching for the (long) prompt we sent, which
   * can easily scroll out of the limited TUI history buffer.
   *
   * Falls back to trying to extract the last JSON object from the tail if the
   * prefix isn't found (defensive for different TUIs).
   */
  locateResponseAfterMarker(rawScreen: string, rawMarker: string): string | null {
    const screen = prepareScreenForJsonExtraction(rawScreen);
    const marker = normalizeWhitespace(rawMarker);

    const tryExtractActionJson = (text: string, label: string): string | null => {
      const actionIdx = text.lastIndexOf('{"action"');
      if (actionIdx === -1) return null;
      try {
        const json = this.extractJson(text.substring(actionIdx));
        if (json.includes('"action"')) {
          this.log(`DEBUG: locate extracted action JSON via ${label}`);
          return json;
        }
      } catch { /* try next anchor */ }
      return null;
    };

    const afterMarker = (text: string, m: string): string | null => {
      const idx = text.lastIndexOf(m);
      if (idx === -1) return null;
      const tail = text.substring(idx + m.length).trim();
      if (tail.length === 0) return null;
      if (tail.startsWith('{')) {
        try {
          return this.extractJson(tail);
        } catch {
          return tryExtractActionJson(tail, 'marker tail');
        }
      }
      return tryExtractActionJson(tail, 'marker tail');
    };

    let content = afterMarker(screen, marker);
    if (content) return content;

    // Model may have dropped the leading « or only partially echoed the token.
    const markerTail = marker.match(/SUPERVISOR_JSON:[^>]+>>?/);
    if (markerTail) {
      content = afterMarker(screen, normalizeWhitespace(markerTail[0]));
      if (content) return content;
    }

    const looseMarker = screen.match(/<<SUPERVISOR_JSON:[^>]+>>/g);
    if (looseMarker?.length) {
      content = afterMarker(screen, looseMarker[looseMarker.length - 1]);
      if (content) return content;
    }

    // Grok emits "◆ Thought for Ns" immediately before the JSON block.
    const thoughtMatches = [...screen.matchAll(/Thought for [\d.]+s/gi)];
    if (thoughtMatches.length) {
      const lastThought = thoughtMatches[thoughtMatches.length - 1];
      const tail = screen.substring(lastThought.index! + lastThought[0].length);
      content = tryExtractActionJson(tail, 'Thought-for anchor');
      if (content) return content;
    }

    content = tryExtractActionJson(screen, '{"action" anchor');
    if (content) return content;

    // Fallback: the prefix may not have been in the sampled buffer, or TUI
    // rendered it differently. Try to pull the last plausible JSON from the tail.
    try {
      const json = this.extractJson(screen);
      if (json.includes('"action"') || json.includes('"type"')) {
        this.log('DEBUG: locate fell back to tail JSON extraction (marker not visible in buffer)');
        return json;
      }
    } catch {}
    return null;
  }

  extractJson(text: string): string {
    const cleaned = prepareScreenForJsonExtraction(text);
    const actionIdx = cleaned.lastIndexOf('{"action"');
    if (actionIdx !== -1) {
      const balanced = extractBalancedJsonObject(cleaned, actionIdx);
      if (balanced) return balanced;
    }

    const start = cleaned.indexOf('{');
    if (start === -1) throw new Error('No JSON opening brace found');

    const balanced = extractBalancedJsonObject(cleaned, start);
    if (!balanced) throw new Error('No matching JSON closing brace found');
    return balanced;
  }

  async executeAction(action: any) {
    this.log(`Executing Action: ${action.type}`);

    if (!this.worker || !this.watchdog) {
      this.log("Cannot execute action: agents not initialized");
      return;
    }

    if (action.type === 'send-prompt') {
      let textToSend = action.text || '';

      if (action.instruct && this.instructTextWithMemory) {
        this.log('Including aimparency instruction text with session memory');
        if (textToSend) {
          textToSend = `${this.instructTextWithMemory}\n\n---\n\n${textToSend}`;
        } else {
          textToSend = this.instructTextWithMemory;
        }
      }

      this.log(`Sending prompt to Worker: ${textToSend.substring(0, 100)}...`);
      await this.post(this.worker, textToSend);
      this.turnCount++;
    } else if (action.type === 'wrap-up') {
      this.log('Planning compact after git commit...');
      this.workingTowardsCommit = true;
      await this.post(this.worker, ActionPrompts.commit());
    } else if (action.type === 'compact') {
      if (!this.workingTowardsCommit) {
        this.log('Compact requested without wrap-up plan. Converting to wrap-up first.');
        this.workingTowardsCommit = true;
        await this.post(this.worker, ActionPrompts.commit());
        this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
        return;
      }
      this.log(`Compacting worker context...`);
      this.workingTowardsCommit = false;

      if (this.sessionMemory) {
        this.log('Extracting session memory before compact...');
        try {
          const summary = await this.sessionMemory.extractReflection(this.worker, this.watchdog);
          if (summary) {
            await this.sessionMemory.saveSummary(summary);
            this.log(`Session memory saved: ${summary.sessionId}`);
          }
        } catch (error) {
          this.log(`Failed to save session memory: ${error}`);
        }
      }

      await this.post(this.worker, this.profile.compactCommand);
    } else if (action.type === 'enter') {
      this.worker.write('\r');
    } else if (action.type === 'select-option') {
      this.log(`Selecting option: ${action.number}`);
      await this.wait(70);
      this.worker.write(String(action.number));
      await this.wait(70);
    } else if (action.type === 'emergency-stop') {
      this.triggerEmergencyStop();
    } else if (action.type === 'stop') {
      this.workingTowardsCommit = false;
      const reason = action.reason || 'Requested by Supervisor';
      this.stop(reason);
    } else if (action.type === 'wait') {
      const duration = action.duration || 30000;
      this.log(`Waiting for ${duration}ms...`);
      this.nextCheckTime = Date.now() + duration;
      return;
    }
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  async retry(error: string) {
    this.retryCount++;
    if (this.retryCount < MAX_RETRIES) {
      this.log(`Retrying watchdog request (Count: ${this.retryCount}). Error: ${error}`);
      await this.wait(5000);
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.currentPromptMarker = `<<SUPERVISOR_JSON:${requestId}>>`;
      const retryMessage = `ERROR: Invalid JSON. Error: ${error}. Retry JSON. Start your reply with ${this.currentPromptMarker} immediately followed by the raw minified JSON.`;
      await this.post(this.watchdog, retryMessage);

      this.waitingForResponseStart = true;
      this.waitingForResponse = false;
      this.responseRequestedAt = Date.now();
      this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
    } else {
      this.log(`[WatchdogService] Max retries (${MAX_RETRIES}) reached. Transitioning to ERROR state and stopping.`);
      this.enterError(`Max retries reached. JSON parsing failed repeatedly. Last error: ${error}`);
    }
  }

  async urgeSupervisorToStickToAvailableActions(attemptedAction: string, validActions: string[]) {
    this.log(`Urging supervisor: invalid action "${attemptedAction}"`);

    const currentState = this.supervisorState.getState();
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.currentPromptMarker = `<<SUPERVISOR_JSON:${requestId}>>`;
    const message = `ERROR: Action "${attemptedAction}" is not valid in ${currentState} state.

Valid actions for ${currentState}: ${validActions.join(', ')}

Please choose one of the valid actions. Respond ONLY with ${this.currentPromptMarker} immediately followed by the raw minified JSON.`;

    await this.post(this.watchdog, message);

    this.waitingForResponseStart = true;
    this.waitingForResponse = false;
    this.responseRequestedAt = Date.now();
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  // ========== STATE MACHINE METHODS ==========

  async executeActionSideEffects(action: any): Promise<void> {
    const actionType = action.type;

    this.log(`[StateMachine] Executing side effects for "${actionType}"`);

    switch (actionType) {
      case 'start_work':
        this.supervisorState.startWork(action.message ?? 'start working');
        await this.executeStartWork(action.message ?? 'start working');
        break;

      case 'break_down':
        await this.executeBreakDown(action.message);
        break;

      case 'ideate':
        await this.executeIdeate(action.text ?? action.approach);
        break;

      case 'text_prompt':
        await this.executeTextPrompt(action.text);
        break;

      case 'verify':
        await this.executeVerify(action.text);
        break;

      case 'revisit':
        await this.executeRevisit(action.text);
        break;

      case 'wrap_up':
        await this.executeWrapUp(action.text);
        break;

      case 'commit':
        await this.executeCommit(action.text);
        break;

      case 'compact':
        await this.executeCompact(action);
        break;

      case 'waiting_for_committed':
        this.log(`[StateMachine] Waiting for committed: ${action.reason || 'no reason'}`);
        this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
        return;

      case 'explore':
        await this.executeExplore(action.text);
        break;

      case 'choice':
        await this.executeChoice(action.choice);
        break;

      case 'retry':
        this.log(`[StateMachine] Retrying, returning to previous state`);
        this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
        return;

      case 'wait':
        const waitDuration = action.duration || 30000;
        this.log(`[StateMachine] Waiting for ${waitDuration}ms. Reason: ${action.reason || 'no reason'}`);
        this.nextCheckTime = Date.now() + waitDuration;
        return;

      default:
        this.log(`[StateMachine] Unknown action type: ${actionType}`);
    }

    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  // ========== STATE MACHINE ACTION EXECUTORS ==========

  /**
   * The full INSTRUCT guide, but only the first time per context epoch; '' after.
   * Re-armed by {@link executeCompact} when the worker's context is wiped.
   */
  private consumeInstructLead(): string {
    if (this.instructSent || !this.instructTextWithMemory) return '';
    this.instructSent = true;
    return `${this.instructTextWithMemory}\n\n---\n\n`;
  }

  private async executeStartWork(message: string): Promise<void> {
    this.log('[StateMachine] Starting work');
    const prompt = `${this.consumeInstructLead()}Check Aimparency MCP for open aims or the current assigned aim. Before making changes, investigate the codebase to see if the aim is already implemented. Sometimes an aim is already done but its status is still open. If you find it is already implemented, update the aim status to "done" via MCP and wait. If it is not implemented, start working. ${message}`;
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeBreakDown(message?: string): Promise<void> {
    this.log('[StateMachine] Breaking down work');
    const defaultPrompt = 'Check Aimparency MCP for the current open aim, break it down into smaller concrete sub-aims or tasks, then continue with the next best step.';
    const prompt = message ? `${defaultPrompt} ${message}` : defaultPrompt;
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeIdeate(text?: string): Promise<void> {
    this.log('[StateMachine] Ideating');
    const defaultPrompt = 'Check Aimparency MCP for open aims and look for the next concrete task to start.';
    const prompt = text ? `${defaultPrompt} ${text}` : defaultPrompt;
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeTextPrompt(text?: string): Promise<void> {
    const prompt = text || 'Keep advancing the work.';
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeVerify(text?: string): Promise<void> {
    const defaultPrompt = 'verify that more than 80% of the tackled requirements have been met. If the work is good enough, prepare to update the aim via Aimparency MCP.';
    const prompt = text ? `${defaultPrompt} ${text}` : defaultPrompt;
    this.supervisorState.updateContext({ metadata: { workSummary: text || defaultPrompt } });
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeRevisit(text?: string): Promise<void> {
    const prompt = text ? `finish implementation. ${text}` : 'finish implementation';
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeWrapUp(text?: string): Promise<void> {
    const defaultPrompt = 'use Aimparency MCP to update aim status and comment and reflection if not done already. Before marking an aim done, record verification evidence matched to its type — code: tests/typecheck pass; UI/visual: a screenshot or interaction proof; bugfix: a repro that now passes.';
    const prompt = text ? `${defaultPrompt}. ${text}` : defaultPrompt;
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeCommit(text?: string): Promise<void> {
    await this.post(this.worker, ActionPrompts.commit(text));
    this.turnCount++;
  }

  private async executeExplore(text?: string): Promise<void> {
    const prompt = text || 'check Aimparency MCP for open aims and see if there is something you can work on';
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeCompact(action: { text?: string; patterns?: string; lessonsLearned?: string; systemLimitations?: string } = {}): Promise<void> {
    this.log('[StateMachine] Compacting worker context');

    // Compaction wipes the worker's context, so this is the one moment to
    // persist what the session learned. Save the summary BEFORE the compact
    // command runs, folding in the supervisor's own reflection fields (approach
    // B) when present. Best-effort: a missing/failed reflection must never block
    // compaction.
    if (this.sessionMemory) {
      try {
        const summary = await this.sessionMemory.extractReflection(this.worker, this.watchdog, {
          patterns: action.patterns,
          lessonsLearned: action.lessonsLearned,
          systemLimitations: action.systemLimitations,
        });
        if (summary) {
          await this.sessionMemory.saveSummary(summary);
          this.log(`Session memory saved: ${summary.sessionId}`);
        }
      } catch (error) {
        this.log(`Failed to save session memory before compact: ${error}`);
      }
    }

    if (action.text) {
        await this.post(this.worker, action.text);
        await this.wait(1000);
    }
    await this.post(this.worker, this.profile.compactCommand);
    this.turnCount = 0;
    // Compaction wipes the worker's context, so re-send the full guide on the
    // next start_work.
    this.instructSent = false;
  }

  private async executeChoice(choice: string): Promise<void> {
    this.log(`[StateMachine] Executing choice: ${choice}`);
    await this.wait(70);
    this.worker.write(choice);
    // Use manual enter for choice
    this.worker.write('\r');
  }
}
