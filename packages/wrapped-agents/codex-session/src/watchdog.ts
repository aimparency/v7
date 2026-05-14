import { Agent } from './agent';
import * as fs from 'fs';
import * as path from 'path';
import { SessionMemory } from './session-memory';
import { AnimatorState, generateSupervisorPrompt, isValidAction, getState, type PromptContext } from '@aimparency/wrapped-agents-common';

// Load instruction text for autonomous guidance
const INSTRUCT_PATH = path.join(__dirname, '../../INSTRUCT.md');
let INSTRUCT_TEXT = '';
try {
  INSTRUCT_TEXT = fs.readFileSync(INSTRUCT_PATH, 'utf-8');
} catch (e) {
  console.warn('[WatchdogService] Could not load INSTRUCT.md:', e);
}

/**
 * Configurable timing constants and behavior flags
 *
 * Environment Variables:
 * - WATCHDOG_POST_ACTION_COOLDOWN: Cooldown period after posting to watchdog (default: 3000ms)
 * - WATCHDOG_INITIAL_WAIT: Initial wait time after posting before checking idle state (default: 2000ms)
 * - WATCHDOG_IDLE_CHECK_INTERVAL: Interval between idle state checks (default: 500ms)
 * - WATCHDOG_MAX_RETRIES: Maximum retries for JSON parsing failures (default: 5)
 * - DEBUG_WATCHDOG: Enable verbose debug logging (default: false, set to 'true' to enable)
 */
const POST_ACTION_COOLDOWN = parseInt(process.env.WATCHDOG_POST_ACTION_COOLDOWN || '3000', 10);
const INITIAL_WAIT_AFTER_POST = parseInt(process.env.WATCHDOG_INITIAL_WAIT || '2000', 10);
const IDLE_CHECK_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_CHECK_INTERVAL || '500', 10);
const MAX_RETRIES = parseInt(process.env.WATCHDOG_MAX_RETRIES || '5', 10);
const RESPONSE_START_TIMEOUT = parseInt(process.env.WATCHDOG_RESPONSE_START_TIMEOUT || '8000', 10);
const RESPONSE_COMPLETION_GRACE_MS = parseInt(process.env.WATCHDOG_RESPONSE_COMPLETION_GRACE_MS || '5000', 10);
const PROCESSING_INTERRUPT_THRESHOLD_MS = parseInt(process.env.WATCHDOG_PROCESSING_INTERRUPT_THRESHOLD_MS || '900000', 10);
const PROCESSING_INTERRUPT_RECHECK_MS = parseInt(process.env.WATCHDOG_PROCESSING_INTERRUPT_RECHECK_MS || '120000', 10);
const WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS = parseInt(process.env.WATCHDOG_WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS || '5000', 10);
const DEBUG_WATCHDOG = process.env.DEBUG_WATCHDOG === 'true';
// Codex may render spinner-like characters depending on terminal mode
const SPINNER_CHARS = ['✻', '·', '✢', '○', '◎', '●', '◯'];
const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";
const WRAP_UP_PROMPT = "Before committing, do a short deletion/reduction pass: remove dead code, collapse unnecessary complexity, and keep only intentional changes. Then track changes and make a git commit for the completed work (usually use `git add -u` first, then `git add` for intentional new files).";
const WRAP_UP_THRESHOLD_GUIDANCE = 'Use wrap-up conservatively. Only choose it after a clearly meaningful milestone is complete and Codex is at a natural stopping point.';

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

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export class WatchdogService {
  worker!: Agent;
  watchdog!: Agent;

  enabled: boolean = false;
  waitingForResponse: boolean = false;
  waitingForResponseStart: boolean = false;
  processing: boolean = false;
  retryCount: number = 0;

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;

  private nextCheckTime = 0;
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
  private instructTextWithMemory: string = INSTRUCT_TEXT;
  private workingTowardsCommit = false;
  private animatorState: AnimatorState = new AnimatorState();
  private projectPath?: string;

  constructor(worker: Agent, watchdog: Agent, expectedModel: string | undefined, compactEvery: number = 1, projectPath?: string) {
    this.projectPath = projectPath;
    this.worker = worker;
    this.watchdog = watchdog;
    this.expectedModel = expectedModel;
    this.compactEvery = compactEvery;

    // Initialize session memory if projectPath provided
    if (projectPath) {
      this.sessionMemory = new SessionMemory(projectPath);
      this.loadSessionMemoryContext(projectPath);
    }
  }

  /**
   * Load recent session memories and inject into instruction context
   */
  private async loadSessionMemoryContext(projectPath: string) {
    try {
      const summaries = await SessionMemory.loadRecentSummaries(projectPath, 5);

      if (summaries.length > 0) {
        const memoryContext = SessionMemory.formatForContext(summaries);
        this.instructTextWithMemory = `${INSTRUCT_TEXT}\n\n${memoryContext}`;
        this.log(`Loaded ${summaries.length} session memories into context`);
      } else {
        this.instructTextWithMemory = INSTRUCT_TEXT;
      }
    } catch (error) {
      this.log(`Failed to load session memory context: ${error}`);
      this.instructTextWithMemory = INSTRUCT_TEXT;
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

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.emergencyStopped = false;
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.nextCheckTime = Date.now() + 500;
      this.turnCount = 0;
      this.workingTowardsCommit = false;
      this.lastStopReason = '';
      this.resetWorkerActivity(Date.now());
      this.resetWatchdogSnapshotState();
    } else {
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.processing = false;
      this.workingTowardsCommit = false;
      this.lastStopReason = '';
      this.resetWorkerActivity(0);
      this.resetWatchdogSnapshotState();
    }
    this.log(`Logic ${enabled ? 'ENABLED' : 'DISABLED'}`);
    this.onStateChange?.();
  }

  stop(reason: string) {
      if (!this.enabled) return;
      this.enabled = false;
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.processing = false;
      this.lastStopReason = reason;
      this.log(`WATCHDOG STOPPED: ${reason}`);
      if (this.onStop) {
          this.onStop(reason);
      }
      this.onStateChange?.();
  }

  triggerEmergencyStop() {
      if (this.emergencyStopped) return;
      this.emergencyStopped = true;
      this.stop("Emergency stop triggered");
      if (this.onEmergencyStop) {
          this.onEmergencyStop();
      }
      this.onStateChange?.();
  }

  getAnimatorStateInfo() {
      const stateName = this.animatorState.getState();
      const stateDefinition = getState(stateName);
      return {
          state: stateName,
          color: stateDefinition?.color ?? '#cccccc'
      };
  }

  onWorkerData(data: string) {
    void data;
  }

  async tick() {
    if (!this.enabled) return;
    if (this.processing) return;
    if (Date.now() < this.nextCheckTime) return;

    // Safety check: ensure agents are initialized
    if (!this.worker || !this.watchdog) {
      this.log("Agents not initialized yet, waiting...");
      this.nextCheckTime = Date.now() + 1000;
      return;
    }

    this.processing = true;

    try {
      const now = Date.now();
      const workerSignals = this.captureAgentSignals(this.worker, false);
      const workerEffectivelyGenerating = this.isWorkerEffectivelyGenerating(workerSignals, now);
      this.log(`Tick start: waitingForResponseStart=${this.waitingForResponseStart} waitingForResponse=${this.waitingForResponse} nextCheckTime=${this.nextCheckTime} now=${Date.now()}`);
      this.log(`Choice menu detection result: ${workerSignals.hasChoiceMenu}`);

      if (workerSignals.hasChoiceMenu && (this.waitingForResponseStart || this.waitingForResponse)) {
        const watchdogSignals = this.captureAgentSignals(this.watchdog, false);
        if (!watchdogSignals.isGenerating) {
          this.log('Worker choice menu preempting stale supervisor wait. Resetting response wait state.');
          this.waitingForResponseStart = false;
          this.waitingForResponse = false;
        }
      }

      if (workerSignals.hasChoiceMenu && !this.waitingForResponseStart && !this.waitingForResponse) {
        this.log('Detected visible worker choice menu. Asking watchdog for immediate selection.');
        await this.askWatchdog();
        this.processing = false;
        return;
      }

      // Waiting for watchdog generation to actually start
      if (this.waitingForResponseStart) {
        this.log('Tick branch: waitingForResponseStart');
        const watchdogSignals = this.captureAgentSignals(this.watchdog, false);
        const watchdogEffectivelyGenerating = this.isWatchdogEffectivelyGenerating(watchdogSignals, now);
        const screenContent = this.readAgentLines(this.watchdog, 500);
        const hasResponseCandidate = this.hasResponseCandidateAfterMarker(screenContent);

        if (hasResponseCandidate) {
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.log('DEBUG: Watchdog response candidate detected after marker.');
        } else if (watchdogEffectivelyGenerating) {
          this.responseSawGenerating = true;
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.log("DEBUG: Watchdog response started (busy indicator detected).");
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        } else if (Date.now() - this.responseRequestedAt <= RESPONSE_START_TIMEOUT) {
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        } else {
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.log(`DEBUG: Response start timeout (${RESPONSE_START_TIMEOUT}ms). Switching to response wait mode and checking buffer directly.`);
        }
      }

      // Check Watchdog Response
      if (this.waitingForResponse) {
        this.log('Tick branch: waitingForResponse');
        const watchdogSignals = this.captureAgentSignals(this.watchdog, false);
        const watchdogEffectivelyGenerating = this.isWatchdogEffectivelyGenerating(watchdogSignals, now);
        const screenContent = this.readAgentLines(this.watchdog, 500);
        const hasResponseCandidate = this.hasResponseCandidateAfterMarker(screenContent);

        if (!hasResponseCandidate && this.shouldDeferResponseCompletion(watchdogEffectivelyGenerating, now)) {
          if (!watchdogEffectivelyGenerating) {
            const elapsed = now - this.responseRequestedAt;
            this.log(`DEBUG: Deferring response completion check (${elapsed}ms < ${RESPONSE_COMPLETION_GRACE_MS}ms grace).`);
          }
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        if (!hasResponseCandidate && watchdogEffectivelyGenerating) {
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        // Watchdog is idle (halted), parse the response
        this.log("DEBUG: Watchdog is idle. Attempting to parse response...");

        this.log(`DEBUG: Screen content length: ${screenContent.length} chars`);

        try {
            this.log("Attempting to extract decision JSON...");
            const jsonString = this.extractDecisionJson(screenContent);
            this.log("JSON extracted. Processing decision...");
            await this.processDecision(jsonString);
        } catch (e: any) {
            if (e?.message === 'WAIT_FOR_RESPONSE_JSON') {
              this.log("DEBUG: Waiting for watchdog JSON response after marker...");
              this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
              this.processing = false;
              return;
            }
            const strippedScreen = stripAnsi(screenContent);
            const markerPresent = strippedScreen.includes(this.currentPromptMarker) || strippedScreen.includes(PROMPT_MARKER);
            this.log(`JSON extraction/parsing failed: ${e}. Marker present: ${markerPresent}. Screen snippet: "${strippedScreen.substring(Math.max(0, strippedScreen.length - 200))}"`);
            this.retry(e.message || "JSON extraction failed");
            return;
        }
        this.processing = false;
        return;
      }

      const workerIdleReason = this.getWorkerIdleEscalationReason(now, workerEffectivelyGenerating);
      this.log(`Worker idle escalation reason: ${workerIdleReason ?? 'none'}`);
      if (workerIdleReason) {
        this.log(workerIdleReason);
        await this.askWatchdog();
        this.markWorkerIdleEscalation(Date.now());
        this.processing = false;
        return;
      }

      // Check Worker Idle
      const workerProcessingDurationMs = this.getWorkerProcessingDurationMs();
      if (
        workerProcessingDurationMs !== null &&
        workerProcessingDurationMs >= PROCESSING_INTERRUPT_THRESHOLD_MS &&
        now - this.lastLongProcessingEscalationAt >= PROCESSING_INTERRUPT_RECHECK_MS
      ) {
        this.lastLongProcessingEscalationAt = now;
        this.log(
          `Detected long worker processing (${Math.round(workerProcessingDurationMs / 1000)}s). Asking watchdog for interrupt decision.`
        );
        await this.askWatchdog();
        this.processing = false;
        return;
      }

      const isWorkerIdle = !workerEffectivelyGenerating;
      this.log(`waitForIdle snapshot isGenerating=${workerEffectivelyGenerating}`);
      this.log(`waitForIdle(worker) result: ${isWorkerIdle}`);

      if (isWorkerIdle) {
          // Check for context clear
          if (this.turnCount >= this.compactEvery) {
              this.log(`Turn count ${this.turnCount} reached limit ${this.compactEvery}. Compacting watchdog context.`);
              this.turnCount = 0;
              await this.post(this.watchdog, '/compact');
              this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
          } else {
              await this.askWatchdog();
          }
      } else {
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
      }
    } catch (e) {
      console.error('[WatchdogService] Error in tick:', e);
    } finally {
      this.processing = false;
    }
  }

  isGenerating(agent: Agent): boolean {
    return this.captureAgentSignals(agent, false).isGenerating;
  }

  private resetWorkerActivity(now: number) {
    this.workerActivity = {
      enabledAt: now,
      observedBusySinceEnabled: false,
      lastBusyAt: 0,
      lastSnapshot: '',
      lastSnapshotAt: 0,
    };
  }

  private resetWatchdogSnapshotState() {
    this.watchdogSnapshotState = {
      lastSnapshot: '',
      lastSnapshotAt: 0,
    };
  }

  private observeWorkerActivity(now: number, isWorkerGenerating?: boolean) {
    const generating = isWorkerGenerating ?? (this.worker ? this.isGenerating(this.worker) : false);
    if (!generating) return;

    this.workerActivity.observedBusySinceEnabled = true;
    this.workerActivity.lastBusyAt = now;
  }

  private isEffectivelyGenerating(signals: AgentSignals, now: number, snapshotState: SnapshotState): boolean {
    if (!signals.isGenerating) {
      snapshotState.lastSnapshot = signals.view.recent30;
      snapshotState.lastSnapshotAt = now;
      return false;
    }

    const snapshot = signals.view.recent30;
    const snapshotUnchanged =
      snapshot.length > 0 &&
      snapshot === snapshotState.lastSnapshot &&
      snapshotState.lastSnapshotAt !== 0 &&
      now - snapshotState.lastSnapshotAt >= IDLE_CHECK_INTERVAL;

    snapshotState.lastSnapshot = snapshot;
    snapshotState.lastSnapshotAt = now;

    return !snapshotUnchanged;
  }

  private isWorkerEffectivelyGenerating(signals: AgentSignals, now: number): boolean {
    if (signals.hasAuthoritativeBusySignal) {
      this.workerActivity.lastSnapshot = signals.view.recent30;
      this.workerActivity.lastSnapshotAt = now;
      return true;
    }
    return this.isEffectivelyGenerating(signals, now, this.workerActivity);
  }

  private isWatchdogEffectivelyGenerating(signals: AgentSignals, now: number): boolean {
    return this.isEffectivelyGenerating(signals, now, this.watchdogSnapshotState);
  }

  private getWorkerIdleEscalationReason(now: number, isWorkerGenerating?: boolean): string | null {
    this.observeWorkerActivity(now, isWorkerGenerating);

    if (this.workerActivity.observedBusySinceEnabled) {
      if (this.workerActivity.lastBusyAt !== 0 && now - this.workerActivity.lastBusyAt >= IDLE_CHECK_INTERVAL) {
        return 'Worker transitioned from busy to not busy. Asking watchdog.';
      }
      return null;
    }

    if (this.workerActivity.enabledAt !== 0 && now - this.workerActivity.enabledAt >= WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS) {
      return `Worker never showed a busy indicator after enable; bootstrap timeout ${WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS}ms reached. Asking watchdog.`;
    }

    return null;
  }

  private markWorkerIdleEscalation(now: number) {
    if (this.workerActivity.observedBusySinceEnabled) {
      this.workerActivity.lastBusyAt = now;
      return;
    }

    this.workerActivity.enabledAt = now;
  }

  private hasVisibleChoiceMenu(agent: Agent): boolean {
    return this.captureAgentSignals(agent, true).hasChoiceMenu;
  }

  private readAgentLines(agent: Agent, count: number): string {
    if (typeof (agent as any).getViewportLines === 'function') {
      return (agent as any).getViewportLines(count);
    }
    if (typeof (agent as any).getLines === 'function') {
      return agent.getLines(count);
    }
    return '';
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

  private detectVisibleChoiceMenu(recentLines: string, shouldLog: boolean): boolean {
    const numberedLines = recentLines.match(/^\s*[›>]?\s*\d+\.\s.+$/gm) || [];
    const hasSelectedOption = /^\s*[›>]\s*\d+\./m.test(recentLines);
    const hasMultipleOptions = numberedLines.length >= 2;
    const hasApprovalCopy = /(allow|cancel|proceed|don't ask again|tool call needs your approval|enter to submit)/i.test(recentLines);
    if (shouldLog) {
      this.log(`hasVisibleChoiceMenu check: hasSelectedOption=${hasSelectedOption} numberedLines=${numberedLines.length}`);
    }
    return hasMultipleOptions && (hasSelectedOption || hasApprovalCopy);
  }

  private detectGenerating(view: AgentView, hasChoiceMenu: boolean): boolean {
    if (hasChoiceMenu) {
      return false;
    }

    const lines = view.recent8.split('\n').filter(Boolean);
    const lastVisibleLine = lines.length > 0 ? lines[lines.length - 1] : '';
    const hasSpinner = SPINNER_CHARS.some(char => lastVisibleLine.includes(char));
    const hasInterruptIndicator = /esc to interrupt/i.test(view.recent8);
    const hasTimedCancelIndicator = /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i.test(view.recent8);
    return hasSpinner || hasInterruptIndicator || hasTimedCancelIndicator;
  }

  private detectAuthoritativeBusySignal(view: AgentView): boolean {
    return (
      /working\s*\(\s*\d+\s*[smh]/i.test(view.recent12) ||
      /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i.test(view.recent12)
    );
  }

  private captureAgentSignals(agent: Agent, shouldLog: boolean = true): AgentSignals {
    const view = this.captureAgentView(agent);
    const hasChoiceMenu = this.detectVisibleChoiceMenu(view.recent50, shouldLog);
    const isGenerating = this.detectGenerating(view, hasChoiceMenu);
    const hasAuthoritativeBusySignal = this.detectAuthoritativeBusySignal(view);
    return { view, hasChoiceMenu, isGenerating, hasAuthoritativeBusySignal };
  }

  private getWorkerProcessingDurationMs(): number | null {
    if (!this.worker) return null;
    const recentLines = stripAnsi(this.readAgentLines(this.worker, 12));
    const durationMatch = recentLines.match(/esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i);
    if (!durationMatch) return null;

    const hours = durationMatch[1] ? Number(durationMatch[1]) : 0;
    const minutes = durationMatch[2] ? Number(durationMatch[2]) : 0;
    const seconds = durationMatch[3] ? Number(durationMatch[3]) : 0;

    if (hours === 0 && minutes === 0 && seconds === 0) {
      return null;
    }
    return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async post(agent: Agent, text: string): Promise<void> {
    const normalizedText = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    this.log(`Posting text to agent... Length: ${normalizedText.length} (raw: ${text.length})`);

    if (normalizedText.length === 0) {
      this.log("Post skipped: normalized text is empty.");
      return;
    }

    // Codex doesn't use vi modes - just write the text directly
    const chunkSize = 100;
    for (let i = 0; i < normalizedText.length; i += chunkSize) {
        const chunk = normalizedText.substring(i, i + chunkSize);
        agent.write(chunk);
        await this.wait(50);
    }

    // Send enter to submit
    await this.wait(100);
    agent.write('\r');
    await this.wait(100);
    this.log("Post complete.");
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
    const supervisedContext = workerSignals.view.recent50.replace(/\s+/g, ' ').trim();

    // Get current state
    const currentState = this.animatorState.getState();
    const stateContext = this.animatorState.getContext();

    this.log(`[StateMachine] Current state: ${currentState}`);
    this.log(`DEBUG: Worker context length: ${supervisedContext.length} chars`);

    // Build prompt context
    const promptContext: PromptContext = {
      state: currentState,
      supervisedContext,
      supervisedStatus: workerSignals.isGenerating ? 'busy' : 'idle',
      requiresInput: workerSignals.hasChoiceMenu
    };

    // Add state-specific context
    if (currentState === 'WORKING' || currentState === 'WRAPPING_UP') {
      promptContext.aimText = stateContext.aimText;
      const workDuration = this.animatorState.getWorkDuration();
      if (workDuration !== null) {
        const minutes = Math.floor(workDuration / 60000);
        const seconds = Math.floor((workDuration % 60000) / 1000);
        promptContext.workDuration = `${minutes}m ${seconds}s`;
      }
    }

    // Generate request ID and prompt using state machine
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const question = generateSupervisorPrompt(promptContext, requestId);
    this.currentPromptMarker = `Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks). [${requestId}]`;

    this.log(`[StateMachine] Generated ${currentState} prompt, length: ${question.length} chars`);
    this.log(`DEBUG: Question (first 500 chars):\n${question.substring(0, 500)}`);

    // Post the state-based question
    await this.post(this.watchdog, question);

    // Capture screen AFTER posting
    await this.wait(500);
    const screenAfter = this.readAgentLines(this.watchdog, 100);
    this.log(`DEBUG: Watchdog screen AFTER post (last 500 chars):\n${screenAfter.substring(Math.max(0, screenAfter.length - 500))}`);

    // Check if Codex is processing (showing spinners)
    const isProcessing = this.captureAgentSignals(this.watchdog, false).isGenerating;
    this.log(`DEBUG: Is watchdog generating after post? ${isProcessing}`);
  }

  async processDecision(jsonString: string) {
    this.waitingForResponseStart = false;
    this.waitingForResponse = false;
    this.log(`Processing decision JSON length: ${jsonString.length}`);

    try {
       this.log(`Parsing JSON: ${jsonString}`);
       jsonString = jsonString.replace(/[\r\n]+/g, ' ');
       const decision = JSON.parse(jsonString);

       if (decision.action) {
         if (decision.action.type === 'choice') {
           this.log(`[StateMachine] Executing choice directly`);
           await this.executeAction({
             type: 'choice',
             choice: decision.action.choice ?? decision.action.key ?? decision.action.number
           });
           this.onStateChange?.();
           return;
         }

         // Attempt action through state machine
         const result = this.animatorState.attemptAction(decision.action);

         if (result.success) {
           // Valid action - execute agent-specific side effects
           this.log(`[StateMachine] Executing ${decision.action.type} → ${result.newState}`);
           await this.executeActionSideEffects(decision.action);
           this.onStateChange?.();
         } else {
           // Invalid action - urge supervisor to stick to available actions
           this.log(`[StateMachine] Invalid action: ${result.error}`);
           await this.urgeSupervisorToStickToAvailableActions(
             decision.action.type,
             result.validActions || []
           );
         }
       }
    } catch (e: any) {
       this.log(`Error parsing JSON decision: ${e.message}`);
       await this.urgeSupervisorToStickToJSONFormat(e.message);
    }
  }

  private shouldDeferResponseCompletion(isGeneratingNow: boolean, now: number = Date.now()): boolean {
    if (isGeneratingNow) {
      this.responseSawGenerating = true;
      return true;
    }

    if (!this.responseSawGenerating) {
      const elapsed = now - this.responseRequestedAt;
      if (elapsed < RESPONSE_COMPLETION_GRACE_MS) {
        return true;
      }
    }

    return false;
  }

  private hasResponseCandidateAfterMarker(screenContent: string): boolean {
    const strippedScreen = stripAnsi(screenContent);
    const markerIndex = strippedScreen.lastIndexOf(this.currentPromptMarker);
    if (markerIndex === -1) return false;
    const afterMarker = strippedScreen.substring(markerIndex + this.currentPromptMarker.length);
    return /{"action"\s*:\s*{/.test(afterMarker);
  }

  extractJson(text: string): string {
    const end = text.lastIndexOf('}');
    if (end === -1) throw new Error("No JSON closing brace found");

    let balance = 0;
    let start = -1;

    for (let i = end; i >= 0; i--) {
      if (text[i] === '}') balance++;
      if (text[i] === '{') balance--;

      if (balance === 0) {
        start = i;
        break;
      }
    }

    if (start === -1) throw new Error("No matching JSON opening brace found");
    return text.substring(start, end + 1);
  }

  private normalizeJsonForParse(input: string): string {
    return input
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractDecisionJson(screenContent: string): string {
    const strippedScreen = stripAnsi(screenContent);
    const candidates: string[] = [];

    const currentMarkerIndex = strippedScreen.lastIndexOf(this.currentPromptMarker);
    if (currentMarkerIndex !== -1) {
      candidates.push(strippedScreen.substring(currentMarkerIndex + this.currentPromptMarker.length).trim());
    }

    const baseMarkerIndex = strippedScreen.lastIndexOf(PROMPT_MARKER);
    if (baseMarkerIndex !== -1) {
      candidates.push(strippedScreen.substring(baseMarkerIndex + PROMPT_MARKER.length).trim());
    }

    const hasMarker = currentMarkerIndex !== -1 || baseMarkerIndex !== -1;
    // Fallback only when marker is missing from terminal output.
    if (!hasMarker) {
      candidates.push(strippedScreen.trim());
    }

    const extractionErrors: string[] = [];
    for (const candidate of candidates) {
      if (!candidate) continue;

      try {
        const jsonString = this.extractJson(candidate);
        const normalizedJsonString = this.normalizeJsonForParse(jsonString);

        let parsed: any;
        try {
          parsed = JSON.parse(jsonString);
        } catch {
          parsed = JSON.parse(normalizedJsonString);
        }

        if (parsed && typeof parsed === 'object' && parsed.action) {
          // Return normalized JSON so downstream parse is deterministic.
          return normalizedJsonString;
        }
      } catch (e: any) {
        extractionErrors.push(e?.message || String(e));
        continue;
      }
    }

    if (hasMarker) {
      throw new Error('WAIT_FOR_RESPONSE_JSON');
    }
    const details = extractionErrors.length ? ` (errors: ${extractionErrors.join(' | ')})` : '';
    throw new Error(`No valid decision JSON with action found${details}`);
  }

  async executeAction(action: any) {
    this.log(`Executing Action: ${action.type}`);

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot execute action: agents not initialized");
      return;
    }

    const actionSignature = JSON.stringify(action ?? {});
    const now = Date.now();
    const isImmediateTerminalAction =
      action?.type === 'choice' ||
      action?.type === 'select-option' ||
      action?.type === 'choose_option' ||
      action?.type === 'enter' ||
      action?.type === 'interrupt';

    if (
      !isImmediateTerminalAction &&
      actionSignature === this.lastExecutedActionSignature &&
      now - this.lastExecutedActionAt < 15000
    ) {
      this.log(`Skipping duplicate action within 15s window: ${actionSignature}`);
      this.nextCheckTime = Date.now() + POST_ACTION_COOLDOWN;
      return;
    }
    this.lastExecutedActionSignature = actionSignature;
    this.lastExecutedActionAt = now;

    if (action.type === 'send-prompt') {
        let textToSend = action.text || '';

        // If instruct flag is set, prepend the aimparency guidance (with session memory)
        if (action.instruct && this.instructTextWithMemory) {
            this.log('Including aimparency instruction text with session memory');
            // Always append the specific instruction/question after the general instructions
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
        await this.post(this.worker, WRAP_UP_PROMPT);
    } else if (action.type === 'commit-done') {
        if (!this.workingTowardsCommit) {
          this.log('commit-done requested without active wrap-up; compacting directly.');
        }
        this.log('Commit wrap-up complete. Compacting worker context...');
        this.workingTowardsCommit = false;
        await this.performCompact();
    } else if (action.type === 'compact') {
        if (!this.workingTowardsCommit) {
          this.log('Compact requested without wrap-up plan. Converting to wrap-up first.');
          this.workingTowardsCommit = true;
          await this.post(this.worker, WRAP_UP_PROMPT);
          this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
          return;
        }
        this.log('Compact requested while workingTowardsCommit is active. Treating this as commit-done.');
        this.workingTowardsCommit = false;
        await this.performCompact();
    } else if (action.type === 'enter') {
        await this.worker.write('\r');
    } else if (action.type === 'select-option' || action.type === 'choose_option' || action.type === 'choice') {
        const rawSelection = action.key ?? action.text ?? action.number;
        const choiceSelection = action.choice;
        const selection =
          typeof choiceSelection === 'number' ? String(choiceSelection) :
          typeof choiceSelection === 'string' ? choiceSelection :
          typeof rawSelection === 'number' ? String(rawSelection) :
          typeof rawSelection === 'string' ? rawSelection :
          '';

        if (!selection) {
          this.log(`${action.type} action missing choice/number/key/text; skipping.`);
          this.nextCheckTime = Date.now() + POST_ACTION_COOLDOWN;
          return;
        }

        this.log(`Selecting option: ${selection}`);
        await this.wait(70);
        if (/^(esc|escape)$/i.test(selection)) {
          await this.worker.write('\x1b');
        } else {
          await this.worker.write(selection);
        }
        await this.wait(70);
    } else if (action.type === 'interrupt') {
        this.log('Interrupting worker generation with double ESC.');
        await this.wait(70);
        await this.worker.write('\x1b');
        await this.wait(70);
        await this.worker.write('\x1b');
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

  private async performCompact() {
    // Extract session memory before compacting
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
        // Continue with compact even if memory extraction fails
      }
    }

    await this.post(this.worker, '/compact');
    // Don't increment turn count, this is maintenance
  }

  async urgeSupervisorToStickToJSONFormat(error: string) {
     this.retryCount++;
     if (this.retryCount < MAX_RETRIES) {
       this.log(`Urging supervisor to fix JSON (Count: ${this.retryCount}). Error: ${error}`);
       await this.wait(1000);
       const message = `ERROR: Invalid JSON. Error: ${error}. Retry with valid JSON.`;
       await this.post(this.watchdog, message);

       this.waitingForResponseStart = false;
       this.waitingForResponse = true;
       this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
     } else {
       console.error(`[WatchdogService] Max retries (${MAX_RETRIES}) reached. Stopping Watchdog.`);
       this.stop(`Max retries (${MAX_RETRIES}) reached. JSON parsing failed repeatedly.`);
     }
  }

  async urgeSupervisorToStickToAvailableActions(attemptedAction: string, validActions: string[]) {
    this.log(`Urging supervisor: invalid action "${attemptedAction}"`);

    const currentState = this.animatorState.getState();
    const message = `ERROR: Action "${attemptedAction}" is not valid in ${currentState} state.

Valid actions for ${currentState}: ${validActions.join(', ')}

Please choose one of the valid actions and respond with correct JSON.`;

    await this.post(this.watchdog, message);

    this.waitingForResponseStart = false;
    this.waitingForResponse = true;
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  async retry(error: string) {
     // Deprecated: use urgeSupervisorToStickToJSONFormat instead
     await this.urgeSupervisorToStickToJSONFormat(error);
  }

  // ========== STATE MACHINE METHODS ==========

  /**
   * Execute agent-specific side effects for an action
   * Note: State transition already happened in attemptAction()
   */
  async executeActionSideEffects(action: any): Promise<void> {
    const actionType = action.type;

    this.log(`[StateMachine] Executing side effects for "${actionType}"`);

    // Update context for specific actions
    switch (actionType) {
      case 'start_work':
        this.animatorState.startWork(action.message ?? 'start working');
        await this.executeStartWork(
          action.message ?? 'start working'
        );
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

      case 'choose_option':
      case 'choice':
        await this.executeAction({
          type: 'choice',
          choice: action.choice ?? action.key ?? action.number
        });
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

      case 'waiting_for_committed':
        this.log(`[StateMachine] Waiting for committed: ${action.reason || 'no reason'}`);
        this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
        return;

      case 'explore':
        await this.executeExplore(action.text);
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

    this.nextCheckTime = Date.now() + POST_ACTION_COOLDOWN;
  }

  // ========== ACTION EXECUTORS ==========

  private async executeStartWork(message: string): Promise<void> {
    this.log(`[StateMachine] Starting work`);

    const prompt = `${this.instructTextWithMemory}

---

Check Aimparency MCP for open aims or the current assigned aim, then start working. ${message}`;

    await this.post(this.worker, prompt);
  }

  private async executeBreakDown(message?: string): Promise<void> {
    this.log('[StateMachine] Breaking down work');

    const defaultPrompt = 'Check Aimparency MCP for the current open aim, break it down into smaller concrete sub-aims or tasks, then continue with the next best step.';
    const prompt = message ? `${defaultPrompt} ${message}` : defaultPrompt;

    await this.post(this.worker, prompt);
  }

  private async executeIdeate(text?: string): Promise<void> {
    this.log('[StateMachine] Ideating');

    const defaultPrompt = 'Check Aimparency MCP for open aims and look for the next concrete task to start.';
    const prompt = text ? `${defaultPrompt} ${text}` : defaultPrompt;
    await this.post(this.worker, prompt);
  }

  private async executeTextPrompt(text?: string): Promise<void> {
    const prompt = text || 'Keep advancing the work.';
    await this.post(this.worker, prompt);
  }

  private async executeVerify(text?: string): Promise<void> {
    const defaultPrompt = 'verify that more than 80% of the tackled requirements have been met. If the work is good enough, prepare to update the aim via Aimparency MCP.';
    const prompt = text ? `${defaultPrompt} ${text}` : defaultPrompt;
    this.animatorState.updateContext({ metadata: { workSummary: text || defaultPrompt } });
    await this.post(this.worker, prompt);
  }

  private async executeRevisit(text?: string): Promise<void> {
    const prompt = text ? `finish implementation. ${text}` : 'finish implementation';
    await this.post(this.worker, prompt);
  }

  private async executeWrapUp(text?: string): Promise<void> {
    const defaultPrompt = 'use Aimparency MCP to update aim status and comment and reflection if not done already, then do a short deletion/reduction pass: remove dead code, simplify where possible, and confirm the remaining diff is intentional before committing';
    const prompt = text ? `${defaultPrompt}. ${text}` : defaultPrompt;
    await this.post(this.worker, prompt);
  }

  private async executeCommit(text?: string): Promise<void> {
    const prompt = text
      ? `Track changes and make a git commit for the completed work. ${text}`
      : WRAP_UP_PROMPT;
    await this.post(this.worker, prompt);
  }

  private async executeExplore(text?: string): Promise<void> {
    const prompt = text || 'check Aimparency MCP for open aims and see if there is something you can work on';
    await this.post(this.worker, prompt);
  }

}
