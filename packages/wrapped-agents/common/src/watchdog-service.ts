import { Agent } from './agent';
import { SessionMemory } from './session-memory';
import { SupervisorState, type AutonomyPolicy } from './supervisor-state';
import { generateSupervisorPrompt, type PromptContext, ActionPrompts } from './supervisor-prompts';
import { getState } from './state-machine-definition';
import type { AgentProfile } from './agent-profile';

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
const MAX_WATCHDOG_TIMEOUT_MS = parseInt(process.env.WATCHDOG_MAX_WATCHDOG_TIMEOUT || '120000', 10); // 2 minutes
const DEBUG_WATCHDOG = process.env.DEBUG_WATCHDOG === 'true';

const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";

const RESPONSE_START_TIMEOUT_MS = 15000;
const RESPONSE_COMPLETION_GRACE_MS = 5000;
const WORKER_IDLE_BOOTSTRAP_TIMEOUT_MS = 20000;

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
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

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;
  autonomyPolicy: AutonomyPolicy;

  private nextCheckTime = 0;
  private busyStartedAt = 0;
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
  private baseInstructText: string = '';
  private instructTextWithMemory: string = '';
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

      if (summaries.length > 0) {
        const memoryContext = SessionMemory.formatForContext(summaries);
        this.instructTextWithMemory = `${this.baseInstructText}\n\n${memoryContext}`;
        this.log(`Loaded ${summaries.length} session memories into context`);
      } else {
        this.instructTextWithMemory = this.baseInstructText;
      }
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

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.emergencyStopped = false;
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
    } else {
      this.waitingForResponse = false;
      this.processing = false;
      this.lastStopReason = '';
    }
    this.log(`Logic ${enabled ? 'ENABLED' : 'DISABLED'}`);
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

  triggerEmergencyStop() {
    if (this.emergencyStopped) return;
    this.emergencyStopped = true;
    this.stop("Quota limit / model switch detected");
    if (this.onEmergencyStop) {
      this.onEmergencyStop();
    }
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
    if (now < this.nextCheckTime) return;

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

        if (watchdogEffectivelyGenerating) {
          this.nextCheckTime = now + IDLE_CHECK_INTERVAL;
          return;
        }

        const elapsedSinceRequest = now - this.responseRequestedAt;
        if (elapsedSinceRequest < RESPONSE_COMPLETION_GRACE_MS) {
          this.log(`DEBUG: Deferring response completion check (${elapsedSinceRequest}ms < ${RESPONSE_COMPLETION_GRACE_MS}ms grace).`);
          this.nextCheckTime = now + 1000;
          return;
        }

        this.log("Watchdog appears idle. Attempting to parse response...");
        const screenContent = this.readAgentLines(this.watchdog, 500);
        const markerIndex = screenContent.lastIndexOf(this.currentPromptMarker);

        if (markerIndex !== -1) {
          const contentToParse = screenContent.substring(markerIndex + this.currentPromptMarker.length).trim();

          if (contentToParse.length > 0) {
            try {
              const jsonString = this.extractJson(contentToParse);
              await this.processDecision(jsonString);
            } catch (e: any) {
              this.log(`DEBUG: JSON extraction/parsing failed: ${e.message}`);
              await this.retry(e.message || "JSON extraction failed");
            }
            return;
          }
        }

        this.log("DEBUG: Response marker not found or content empty. Waiting...");
        this.nextCheckTime = now + 1000;
        return;
      }

      // 3. Monitor Worker Activity and Escalate if Idle
      const workerSignals = this.captureAgentSignals(this.worker, false);
      const workerIdleReason = this.getWorkerIdleEscalationReason(now, workerSignals.isGenerating);

      if (workerIdleReason) {
        this.log(`Escalating to Watchdog: ${workerIdleReason}`);
        this.markWorkerIdleEscalation(now);

        if (this.turnCount >= this.compactEvery) {
          this.log(`Turn count ${this.turnCount} reached limit ${this.compactEvery}. Compacting watchdog context.`);
          this.turnCount = 0;
          await this.post(this.watchdog, this.profile.compactCommand);
          this.nextCheckTime = now + INITIAL_WAIT_AFTER_POST;
        } else {
          await this.askWatchdog();
        }
      } else {
        if (this.busyStartedAt === 0) {
          this.busyStartedAt = now;
        } else {
          const busyDuration = now - this.busyStartedAt;
          if (busyDuration > MAX_BUSY_TIMEOUT_MS) {
            this.log(`Worker busy for ${Math.floor(busyDuration/1000)}s (limit: ${MAX_BUSY_TIMEOUT_MS/1000}s). Triggering ERROR.`);
            this.supervisorState.triggerError(`Worker session stuck (busy timeout reached after ${Math.floor(busyDuration/1000)}s)`);
            this.busyStartedAt = 0;
            this.onStateChange?.();
            this.processing = false;
            return;
          }
        }
        this.nextCheckTime = now + IDLE_CHECK_INTERVAL;
      }

    } catch (e) {
      console.error('[WatchdogService] Error in tick:', e);
    } finally {
      this.processing = false;
    }
  }

  private resetWatchdogSnapshotState() {
    this.watchdogSnapshotState = {
      lastSnapshot: '',
      lastSnapshotAt: 0,
    };
  }

  private isEffectivelyGenerating(signals: AgentSignals, now: number, snapshotState: SnapshotState): boolean {
    if (signals.isGenerating) return true;

    if (!snapshotState.lastSnapshot) {
      snapshotState.lastSnapshot = signals.view.recent8;
      snapshotState.lastSnapshotAt = now;
      return true;
    }

    if (signals.view.recent8 !== snapshotState.lastSnapshot) {
      snapshotState.lastSnapshot = signals.view.recent8;
      snapshotState.lastSnapshotAt = now;
      return true;
    }

    const idleTime = now - snapshotState.lastSnapshotAt;
    return idleTime < IDLE_DEBOUNCE_INTERVAL;
  }

  private observeWorkerActivity(now: number, isWorkerGenerating?: boolean) {
    if (isWorkerGenerating) {
      this.workerActivity.observedBusySinceEnabled = true;
      this.workerActivity.lastBusyAt = now;
    }
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

    // Spinner glyphs and busy footers are per-agent (CLI TUIs differ) via the profile.
    if (this.profile.spinnerPattern.test(view.recent8)) return true;
    return this.profile.busyPatterns.some(p => p.test(view.recent8));
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
    this.log(`Posting to ${agent === this.worker ? 'Worker' : 'Watchdog'}: ${text.substring(0, 50)}...`);

    for (const char of text) {
      agent.write(char);
      await this.wait(50);
    }

    // Send enter to submit
    await this.wait(100);
    agent.write('\r');
    await this.wait(100);
    this.log("Post complete.");
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
    const supervisedContext = workerSignals.view.recent50.replace(/\s+/g, ' ').trim();

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
    this.currentPromptMarker = `Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks). [${requestId}]`;

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
      const retryMessage = `ERROR: Invalid JSON. Error: ${error}. Retry JSON.`;
      await this.post(this.watchdog, retryMessage);

      this.waitingForResponseStart = true;
      this.waitingForResponse = false;
      this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
    } else {
      this.log(`[WatchdogService] Max retries (${MAX_RETRIES}) reached. Transitioning to ERROR state.`);
      this.supervisorState.triggerError(`Max retries reached. JSON parsing failed repeatedly. Last error: ${error}`);
      this.onStateChange?.();
    }
  }

  async urgeSupervisorToStickToAvailableActions(attemptedAction: string, validActions: string[]) {
    this.log(`Urging supervisor: invalid action "${attemptedAction}"`);

    const currentState = this.supervisorState.getState();
    const message = `ERROR: Action "${attemptedAction}" is not valid in ${currentState} state.

Valid actions for ${currentState}: ${validActions.join(', ')}

Please choose one of the valid actions and respond with correct JSON.`;

    await this.post(this.watchdog, message);

    this.waitingForResponseStart = true;
    this.waitingForResponse = false;
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
        await this.executeCompact(action.text);
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

  private async executeStartWork(message: string): Promise<void> {
    this.log('[StateMachine] Starting work');
    const prompt = `${this.instructTextWithMemory}\n\n---\n\nCheck Aimparency MCP for open aims or the current assigned aim. Before making changes, investigate the codebase to see if the aim is already implemented. Sometimes an aim is already done but its status is still open. If you find it is already implemented, update the aim status to "done" via MCP and wait. If it is not implemented, start working. ${message}`;
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
    const defaultPrompt = 'use Aimparency MCP to update aim status and comment and reflection if not done already';
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

  private async executeCompact(text?: string): Promise<void> {
    this.log('[StateMachine] Compacting worker context');
    if (text) {
        await this.post(this.worker, text);
        await this.wait(1000);
    }
    await this.post(this.worker, this.profile.compactCommand);
    this.turnCount = 0;
  }

  private async executeChoice(choice: string): Promise<void> {
    this.log(`[StateMachine] Executing choice: ${choice}`);
    await this.wait(70);
    this.worker.write(choice);
    // Use manual enter for choice
    this.worker.write('\r');
  }
}
