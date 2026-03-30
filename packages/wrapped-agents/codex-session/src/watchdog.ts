import { Agent } from './agent';
import * as fs from 'fs';
import * as path from 'path';
import { SessionMemory } from './session-memory';
import { AnimatorState, generateSupervisorPrompt, isValidAction, type PromptContext } from '@aimparency/wrapped-agents-common';

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
 * - WATCHDOG_IDLE_DEBOUNCE: Debounce interval for idle detection (default: 100ms)
 * - WATCHDOG_MAX_RETRIES: Maximum retries for JSON parsing failures (default: 5)
 * - DEBUG_WATCHDOG: Enable verbose debug logging (default: false, set to 'true' to enable)
 */
const POST_ACTION_COOLDOWN = parseInt(process.env.WATCHDOG_POST_ACTION_COOLDOWN || '3000', 10);
const INITIAL_WAIT_AFTER_POST = parseInt(process.env.WATCHDOG_INITIAL_WAIT || '2000', 10);
const IDLE_CHECK_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_CHECK_INTERVAL || '500', 10);
const IDLE_DEBOUNCE_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_DEBOUNCE || '100', 10);
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
const WRAP_UP_PROMPT = "Track changes and make a git commit for the completed work (usually use `git add -u` first, then `git add` for intentional new files).";
const WRAP_UP_THRESHOLD_GUIDANCE = 'Use wrap-up conservatively. Only choose it after a clearly meaningful milestone is complete and Codex is at a natural stopping point.';

interface WorkerActivityState {
  enabledAt: number;
  observedBusySinceEnabled: boolean;
  lastBusyAt: number;
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
  private workerActivity: WorkerActivityState = {
    enabledAt: 0,
    observedBusySinceEnabled: false,
    lastBusyAt: 0,
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
    } else {
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.processing = false;
      this.workingTowardsCommit = false;
      this.lastStopReason = '';
      this.resetWorkerActivity(0);
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

  onWorkerData(data: string) {
    void data;
    this.observeWorkerActivity(Date.now());
    if (this.enabled && !this.waitingForResponse && !this.waitingForResponseStart) {
        this.nextCheckTime = Math.max(this.nextCheckTime, Date.now() + IDLE_CHECK_INTERVAL);
    }
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
      // Waiting for watchdog generation to actually start
      if (this.waitingForResponseStart) {
        const isGenerating = this.isGenerating(this.watchdog);
        if (isGenerating) {
          this.responseSawGenerating = true;
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.log("DEBUG: Watchdog response started (busy indicator detected).");
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        const elapsed = Date.now() - this.responseRequestedAt;
        if (elapsed > RESPONSE_START_TIMEOUT) {
          const screenContent = this.watchdog.getLines(500);
          const hasResponseCandidate = this.hasResponseCandidateAfterMarker(screenContent);
          if (hasResponseCandidate) {
            this.waitingForResponseStart = false;
            this.waitingForResponse = true;
            this.log(`DEBUG: Response start timeout (${RESPONSE_START_TIMEOUT}ms), but detected response candidate after marker. Switching to response wait mode.`);
          } else {
            this.log(`DEBUG: Response start timeout (${RESPONSE_START_TIMEOUT}ms) without busy indicator or response candidate. Remaining in response-start wait mode.`);
            this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
            this.processing = false;
            return;
          }
        } else {
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }
      }

      // Check Watchdog Response
      if (this.waitingForResponse) {
        const now = Date.now();
        const isGeneratingNow = this.isGenerating(this.watchdog);
        if (this.shouldDeferResponseCompletion(isGeneratingNow, now)) {
          if (!isGeneratingNow) {
            const elapsed = now - this.responseRequestedAt;
            this.log(`DEBUG: Deferring response completion check (${elapsed}ms < ${RESPONSE_COMPLETION_GRACE_MS}ms grace).`);
          }
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        // waitForIdle checks isGenerating(), so if it returns true, the watchdog has halted
        const isIdle = await this.waitForIdle(this.watchdog);

        if (!isIdle) {
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        // Watchdog is idle (halted), parse the response
        this.log("DEBUG: Watchdog is idle. Attempting to parse response...");
        const screenContent = this.watchdog.getLines(500);

        this.log(`DEBUG: Screen content length: ${screenContent.length} chars`);
        this.log(`DEBUG: First 400 chars of screen:\n${screenContent.substring(0, 400)}`);
        this.log(`DEBUG: Last 400 chars of screen:\n${screenContent.substring(Math.max(0, screenContent.length - 400))}`);
        this.log(`DEBUG: Looking for marker: "${this.currentPromptMarker}"`);

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

      // Approval/confirmation menus should be handled immediately.
      if (this.hasVisibleChoiceMenu(this.worker)) {
        this.log('Detected visible worker choice menu. Asking watchdog for immediate selection.');
        await this.askWatchdog();
        this.processing = false;
        return;
      }

      const workerIdleReason = this.getWorkerIdleEscalationReason(Date.now());
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
        Date.now() - this.lastLongProcessingEscalationAt >= PROCESSING_INTERRUPT_RECHECK_MS
      ) {
        this.lastLongProcessingEscalationAt = Date.now();
        this.log(
          `Detected long worker processing (${Math.round(workerProcessingDurationMs / 1000)}s). Asking watchdog for interrupt decision.`
        );
        await this.askWatchdog();
        this.processing = false;
        return;
      }

      const isWorkerIdle = await this.waitForIdle(this.worker);

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
          this.nextCheckTime = Date.now() + IDLE_DEBOUNCE_INTERVAL;
      }
    } catch (e) {
      console.error('[WatchdogService] Error in tick:', e);
    } finally {
      this.processing = false;
    }
  }

  async waitForIdle(agent: Agent): Promise<boolean> {
    let previousContent = agent.getLines(30);

    if (this.isGenerating(agent)) return false;

    for (let i = 0; i < 5; i++) {
      await this.wait(100);
      if (this.isGenerating(agent)) return false;

      const currentContent = agent.getLines(30);
      if (currentContent !== previousContent) {
        return false;
      }
      previousContent = currentContent;
    }
    return true;
  }

  isGenerating(agent: Agent): boolean {
    const lastLine = agent.getLastLine();
    const recentLines = stripAnsi(agent.getLines(8));
    const hasSpinner = SPINNER_CHARS.some(char => lastLine.includes(char));
    // Codex shows "esc to interrupt" while it is actively generating.
    // Check recent lines because zoom/terminal wrapping can move this off the last line.
    const hasBusyIndicator = /esc to (interrupt|cancel)/i.test(recentLines);
    return hasSpinner || hasBusyIndicator;
  }

  private resetWorkerActivity(now: number) {
    this.workerActivity = {
      enabledAt: now,
      observedBusySinceEnabled: false,
      lastBusyAt: 0,
    };
  }

  private observeWorkerActivity(now: number) {
    if (!this.worker) return;
    if (!this.isGenerating(this.worker)) return;

    this.workerActivity.observedBusySinceEnabled = true;
    this.workerActivity.lastBusyAt = now;
  }

  private getWorkerIdleEscalationReason(now: number): string | null {
    this.observeWorkerActivity(now);

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
    const recentLines = stripAnsi(agent.getLines(24));
    const hasApprovalHeading =
      /Would you like to run the following command\?/i.test(recentLines) ||
      /Would you like to make the following edits\?/i.test(recentLines) ||
      /Would you like to /i.test(recentLines);
    const hasSelectedOption = /^\s*›\s*\d+\./m.test(recentLines);
    const hasShortcutOptions = /\((?:y|p|a|esc)\)/i.test(recentLines);

    return hasApprovalHeading && hasSelectedOption && hasShortcutOptions;
  }

  private getWorkerProcessingDurationMs(): number | null {
    if (!this.worker) return null;
    const recentLines = stripAnsi(this.worker.getLines(12));
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

  private async ensureInsertMode(agent: Agent) {
    await this.wait(70);
    agent.write('\x1b'); // ESC to Normal Mode
    await this.wait(70);
    agent.write('i');    // 'i' to Insert Mode
    await this.wait(70);
  }

  private async ensureEnter(agent: Agent): Promise<void> {
    await this.wait(70);
    agent.write('\r\n');
    await this.wait(70);
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
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;

    const rawContext = stripAnsi(this.worker.getLines(40));
    const supervisedContext = rawContext.replace(/\s+/g, ' ').trim();

    // Get current state
    const currentState = this.animatorState.getState();
    const stateContext = this.animatorState.getContext();

    this.log(`[StateMachine] Current state: ${currentState}`);
    this.log(`DEBUG: Worker context length: ${supervisedContext.length} chars`);

    // Build prompt context
    const promptContext: PromptContext = {
      state: currentState,
      supervisedContext,
      // TODO: Get these from MCP
      activePhases: [],
      openAimsCount: 0,
      computeCredits: 0
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
      promptContext.supervisedStatus = this.isGenerating(this.worker) ? 'busy' : 'idle';
    }

    if (currentState === 'ERROR') {
      promptContext.metadata = {
        errorCount: stateContext.errorCount,
        lastError: stateContext.lastError,
        previousState: stateContext.previousState
      };
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
    const screenAfter = this.watchdog.getLines(100);
    this.log(`DEBUG: Watchdog screen AFTER post (last 500 chars):\n${screenAfter.substring(Math.max(0, screenAfter.length - 500))}`);

    // Check if Codex is processing (showing spinners)
    const isProcessing = this.isGenerating(this.watchdog);
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
         // Check if this is a state machine action
         const actionType = decision.action.type;
         const currentState = this.animatorState.getState();

         if (isValidAction(currentState, actionType)) {
           // State machine action - process via state machine
           this.log(`[StateMachine] Processing state machine action: ${actionType}`);
           await this.processStateMachineAction(decision.action);
         } else {
           // Fall back to old action handling for legacy actions
           this.log(`[Legacy] Processing legacy action: ${actionType}`);
           await this.executeAction(decision.action);
         }
       }
    } catch (e: any) {
       this.log(`Error parsing JSON decision: ${e.message}`);
       this.retry(e.message);
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
    if (
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
        this.worker.write('\r');
    } else if (action.type === 'select-option') {
        const rawSelection = action.key ?? action.text ?? action.number;
        const selection =
          typeof rawSelection === 'number' ? String(rawSelection) :
          typeof rawSelection === 'string' ? rawSelection :
          '';

        if (!selection) {
          this.log('select-option action missing number/key/text; skipping.');
          this.nextCheckTime = Date.now() + POST_ACTION_COOLDOWN;
          return;
        }

        this.log(`Selecting option: ${selection}`);
        await this.wait(70);
        if (/^(esc|escape)$/i.test(selection)) {
          this.worker.write('\x1b');
        } else {
          this.worker.write(selection);
        }
        await this.wait(70);
    } else if (action.type === 'interrupt') {
        this.log('Interrupting worker generation with double ESC.');
        await this.wait(70);
        this.worker.write('\x1b');
        await this.wait(70);
        this.worker.write('\x1b');
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

  async retry(error: string) {
     this.retryCount++;
     if (this.retryCount < MAX_RETRIES) {
       this.log(`Retrying watchdog request (Count: ${this.retryCount}). Error: ${error}`);
       await this.wait(1000);
       const retryMessage = `ERROR: Invalid JSON. Error: ${error}. Retry with valid JSON.`;
       await this.post(this.watchdog, retryMessage);

       this.waitingForResponseStart = false;
       this.waitingForResponse = true;
       this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
     } else {
       console.error(`[WatchdogService] Max retries (${MAX_RETRIES}) reached. Stopping Watchdog.`);
       this.stop(`Max retries (${MAX_RETRIES}) reached. JSON parsing failed repeatedly.`);
       // Do not kill the worker or exit process, just disable watchdog
     }
  }

  // ========== STATE MACHINE METHODS ==========

  async processStateMachineAction(action: any): Promise<void> {
    const actionType = action.type;
    const currentState = this.animatorState.getState();

    this.log(`[StateMachine] Processing action "${actionType}" in state "${currentState}"`);

    // Execute based on state
    switch (currentState) {
      case 'EXPLORING':
        await this.handleExploringAction(action);
        break;
      case 'WORKING':
        await this.handleWorkingAction(action);
        break;
      case 'WRAPPING_UP':
        await this.handleWrappingUpAction(action);
        break;
      case 'ERROR':
        await this.handleErrorAction(action);
        break;
    }

    this.nextCheckTime = Date.now() + POST_ACTION_COOLDOWN;
  }

  private async handleExploringAction(action: any): Promise<void> {
    switch (action.type) {
      case 'start_work':
        await this.executeStartWork(action.aim_id, action.aim_text, action.strategy);
        this.animatorState.startWork(action.aim_id, action.aim_text, action.strategy);
        this.animatorState.transition('WORKING', 'start_work', action);
        break;

      case 'break_down':
        await this.executeBreakDown(action.aim_id);
        break;

      case 'ideate':
        await this.executeIdeate(action.ideation_type);
        break;

      case 'wait':
        this.log(`[StateMachine] Waiting: ${action.reason || 'no reason'}`);
        break;
    }
  }

  private async handleWorkingAction(action: any): Promise<void> {
    switch (action.type) {
      case 'proceed':
        await this.executeProceed(action);
        break;

      case 'wrap_up':
        this.log(`[StateMachine] Wrapping up: ${action.summary || 'no summary'}`);
        this.animatorState.updateContext({ metadata: { workSummary: action.summary } });
        this.animatorState.transition('WRAPPING_UP', 'wrap_up', action);
        break;
    }
  }

  private async handleWrappingUpAction(action: any): Promise<void> {
    switch (action.type) {
      case 'verify_complete':
        await this.executeVerifyComplete(action.notes);
        this.animatorState.transition('EXPLORING', 'verify_complete', action);
        break;

      case 'verify_incomplete':
        await this.executeVerifyIncomplete(action.missing);
        this.animatorState.transition('WORKING', 'verify_incomplete', action);
        break;
    }
  }

  private async handleErrorAction(action: any): Promise<void> {
    const context = this.animatorState.getContext();
    const previousState = context.previousState || 'EXPLORING';

    switch (action.type) {
      case 'retry':
        this.log(`[StateMachine] Retrying, returning to ${previousState}`);
        this.animatorState.transition(previousState, 'retry', action);
        break;

      case 'reset':
        this.log(`[StateMachine] Resetting to EXPLORING`);
        this.animatorState.transition('EXPLORING', 'reset', action);
        break;

      case 'abort':
        this.log(`[StateMachine] Aborting: ${action.reason || 'no reason'}`);
        this.animatorState.transition('EXPLORING', 'abort', action);
        break;
    }
  }

  // ========== ACTION EXECUTORS ==========

  private async executeStartWork(aimId: string, aimText: string, strategy: string): Promise<void> {
    this.log(`[StateMachine] Starting work on: ${aimText}`);

    const prompt = `${this.instructTextWithMemory}

---

Work on this aim:
ID: ${aimId}
Text: ${aimText}
Strategy: ${strategy}

Begin implementation.`;

    await this.post(this.worker, prompt);
  }

  private async executeBreakDown(aimId: string): Promise<void> {
    this.log(`[StateMachine] Breaking down aim: ${aimId}`);

    const prompt = `Break down this aim into smaller sub-aims. Use create_aim MCP tool with supportedAims array pointing to parent: ${aimId}`;

    await this.post(this.worker, prompt);
  }

  private async executeIdeate(ideationType: string): Promise<void> {
    this.log(`[StateMachine] Ideating: ${ideationType}`);

    const prompts: Record<string, string> = {
      research: 'Do web research on relevant topics. Create aims for insights.',
      new_aims: 'Review codebase and create aims for improvements: refactoring, tests, docs, security, performance.',
      improvements: 'Review recent work and suggest optimizations as aims.'
    };

    const prompt = prompts[ideationType] || 'Think about improvements and create aims.';
    await this.post(this.worker, prompt);
  }

  private async executeProceed(action: any): Promise<void> {
    const proceedType = action.proceed_type;

    switch (proceedType) {
      case 'none':
        this.log(`[StateMachine] Monitoring (no action)`);
        break;

      case 'motivate':
        this.log(`[StateMachine] Sending motivation`);
        await this.post(this.worker, action.text || 'Keep working on the aim.');
        break;

      case 'option_select':
        this.log(`[StateMachine] Selecting option: ${action.choice}`);
        await this.post(this.worker, action.choice);
        break;

      case 'escalate':
        this.log(`[StateMachine] Escalating: ${action.question}`);
        // TODO: Implement human escalation
        break;
    }
  }

  private async executeVerifyComplete(notes: string): Promise<void> {
    this.log(`[StateMachine] Verify complete: ${notes}`);

    // Step 1: Verify
    await this.post(this.worker, 'Use get_aim_context to verify aim is complete.');
    await this.waitForWorkerIdle();

    // Step 2: Commit
    await this.post(this.worker, 'Create git commit. Use git add -u, then git add for new files, then commit.');
    await this.waitForWorkerIdle();

    // Step 3: Reflect
    await this.post(this.worker, 'Add reflection using addReflection MCP tool.');
    await this.waitForWorkerIdle();

    // Step 4: Compact
    this.turnCount = 0;
    await this.post(this.watchdog, '/compact');
  }

  private async executeVerifyIncomplete(missing: string): Promise<void> {
    this.log(`[StateMachine] Incomplete: ${missing}`);

    const prompt = `Work not complete. Missing: ${missing}. Continue working.`;
    await this.post(this.worker, prompt);
  }

  private async waitForWorkerIdle(): Promise<void> {
    await this.wait(2000);
    for (let i = 0; i < 60; i++) {
      if (!this.isGenerating(this.worker)) {
        const lines = this.worker.getLines(10);
        await this.wait(1000);
        if (lines === this.worker.getLines(10)) return;
      }
      await this.wait(1000);
    }
    this.log('[StateMachine] Warning: timeout waiting for worker idle');
  }
}
