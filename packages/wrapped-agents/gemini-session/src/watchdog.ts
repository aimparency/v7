import { Agent } from './agent';
import * as fs from 'fs';
import * as path from 'path';
import { SupervisorState, generateSupervisorPrompt, isValidAction, getState, type PromptContext, type AutonomyPolicy, ActionPrompts } from '@aimparency/wrapped-agents-common';

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

const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export class WatchdogService {
  worker!: Agent;
  watchdog!: Agent;

  enabled: boolean = false;
  waitingForResponse: boolean = false;
  processing: boolean = false;
  retryCount: number = 0;

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;
  autonomyPolicy: AutonomyPolicy;

  private nextCheckTime = 0;
  private busyStartedAt = 0;
  private watchdogBusyStartedAt = 0;
  private compactPlanned = false;
  private supervisorState: SupervisorState = new SupervisorState();

  constructor(worker: Agent, watchdog: Agent, expectedModel: string | undefined, compactEvery: number = 1, autonomyPolicy: AutonomyPolicy = {}) {
    this.worker = worker;
    this.watchdog = watchdog;
    this.expectedModel = expectedModel;
    this.compactEvery = compactEvery;
    this.autonomyPolicy = autonomyPolicy;
  }
  
  private log(msg: string) {
    if (process.env.DEBUG_WATCHDOG === 'true') {
        console.log(`[${new Date().toISOString()}] [WatchdogService] ${msg}`);
    }
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
      this.waitingForResponse = false; // Reset waiting state
      this.processing = false;         // Reset processing state
      this.nextCheckTime = Date.now() + 500; 
      this.turnCount = 0; // Reset turn count on enable? Or keep it? Reset feels safer.
      this.busyStartedAt = 0;
      this.watchdogBusyStartedAt = 0;
      this.compactPlanned = false;
      this.lastStopReason = '';
    } else {
      this.waitingForResponse = false;
      this.processing = false;
      this.compactPlanned = false;
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
    if (Date.now() < this.nextCheckTime) return;

    this.processing = true;

    try {
      // Check Watchdog Response
      if (this.waitingForResponse) {
        // Check for idle
        const isIdle = await this.waitForIdle(this.watchdog);
        
        if (!isIdle) {
          if (this.watchdogBusyStartedAt === 0) {
            this.watchdogBusyStartedAt = Date.now();
          } else {
            const watchdogBusyDuration = Date.now() - this.watchdogBusyStartedAt;
            if (watchdogBusyDuration > MAX_WATCHDOG_TIMEOUT_MS) {
              this.log(`Watchdog busy for ${Math.floor(watchdogBusyDuration/1000)}s (limit: ${MAX_WATCHDOG_TIMEOUT_MS/1000}s). Triggering ERROR.`);
              this.supervisorState.triggerError(`Watchdog session stuck (busy timeout reached after ${Math.floor(watchdogBusyDuration/1000)}s)`);
              this.watchdogBusyStartedAt = 0;
              this.onStateChange?.();
              this.processing = false;
              return;
            }
          }
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        this.watchdogBusyStartedAt = 0;
        // We are confident the watchdog is idle. Try to parse.
          
          const screenContent = this.watchdog.getLines(500); 
          const markerIndex = screenContent.lastIndexOf(PROMPT_MARKER);
          let contentToParse = "";

          if (markerIndex !== -1) {
               contentToParse = screenContent.substring(markerIndex + PROMPT_MARKER.length).trim();
          } else {
               this.log("PROMPT_MARKER not found in last 500 lines. Waiting...");
               this.log(`DEBUG: Last 20 lines of content:\n${screenContent.split('\n').slice(-20).join('\n')}`);
               this.nextCheckTime = Date.now() + 1000;
               this.processing = false;
               return;
          }

          if (contentToParse.length === 0) {
               this.log("Watchdog idle but response content empty. Waiting...");
               this.nextCheckTime = Date.now() + 500;
               this.processing = false;
               return;
          }

          try {
              this.log("Attempting to extract JSON...");
              const jsonString = this.extractJson(contentToParse); 
              this.log("JSON extracted. Processing decision...");
              await this.processDecision(jsonString);
          } catch (e: any) {
              this.log(`JSON extraction/parsing failed: ${e}. Content length: ${contentToParse.length}`);
              await this.retry(e.message || "JSON extraction failed");
              return; 
          }
        this.processing = false;
        return;
      }

      // Check Worker Idle
      const isWorkerIdle = await this.waitForIdle(this.worker);
      
      if (isWorkerIdle) {
          this.busyStartedAt = 0;
          // Check for context clear
          if (this.turnCount >= this.compactEvery) {
              this.log(`Turn count ${this.turnCount} reached limit ${this.compactEvery}. Compressing watchdog context.`);
              this.turnCount = 0;
              await this.post(this.watchdog, '/compress');
              this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
          } else {
              await this.askWatchdog(); // This sets waitingForResponse=true
          }
      } else {
          if (this.busyStartedAt === 0) {
            this.busyStartedAt = Date.now();
          } else {
            const busyDuration = Date.now() - this.busyStartedAt;
            if (busyDuration > MAX_BUSY_TIMEOUT_MS) {
                this.log(`Worker busy for ${Math.floor(busyDuration/1000)}s (limit: ${MAX_BUSY_TIMEOUT_MS/1000}s). Triggering ERROR.`);
                this.supervisorState.triggerError(`Worker session stuck (busy timeout reached after ${Math.floor(busyDuration/1000)}s)`);
                this.busyStartedAt = 0;
                this.onStateChange?.();
                this.processing = false;
                return;
            }
          }
          this.nextCheckTime = Date.now() + IDLE_DEBOUNCE_INTERVAL;
      }
    } catch (e) {
      console.error('[WatchdogService] Error in tick:', e);
    } finally {
      this.processing = false;
    }
  }

  // Checks for idle state: No spinner/cancel for 5 consecutive checks of 100ms
  // Also checks that content hasn't changed
  async waitForIdle(agent: Agent): Promise<boolean> {
    let previousContent = this.readAgentLines(agent, 100);

    if (this.isGenerating(agent)) return false;

    for (let i = 0; i < 5; i++) {
      await this.wait(100);
      if (this.isGenerating(agent)) return false;

      const currentContent = this.readAgentLines(agent, 100);
      if (currentContent !== previousContent) {
        return false;
      }
      previousContent = currentContent;
    }
    return true;
  }

  isGenerating(agent: Agent): boolean {
    const lastLine = this.readAgentLastLine(agent);
    const recentLines = stripAnsi(this.readAgentLines(agent, 8));
    
    // xterm spinner characters and other indicators
    const hasSpinner = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(lastLine);
    const hasInterruptIndicator = /esc to interrupt/i.test(recentLines);
    const hasTimedCancelIndicator = /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i.test(recentLines);
    
    return hasSpinner || hasInterruptIndicator || hasTimedCancelIndicator;
  }

  hasChoiceMenu(agent: Agent): boolean {
    const recentLines = stripAnsi(this.readAgentLines(agent, 8));
    // Support xterm-style (inquirer) menus and common (Y/n) patterns
    const hasInquirerMenu = /›.*enter to submit | esc to cancel/i.test(recentLines);
    const hasYesNoPrompt = /\?.*\(Y\/n\)/i.test(recentLines);
    const hasChoiceA_B = /\([A-Z]\).* \([A-Z]\)/.test(recentLines);
    
    return hasInquirerMenu || hasYesNoPrompt || hasChoiceA_B;
  }

  readAgentLines(agent: Agent, count: number): string {
    return agent.getLines(count);
  }

  readAgentLastLine(agent: Agent): string {
    const lines = agent.getLines(1).split('\n');
    return lines[lines.length - 1] || '';
  }

  async wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async ensureEnter(agent: Agent) {
      // Send double enter to ensure command is submitted
      agent.write('\r');
      await this.wait(100);
      agent.write('\r');
  }

  async post(agent: Agent, text: string) {
    this.log(`Posting to ${agent === this.worker ? 'Worker' : 'Watchdog'}: ${text.substring(0, 50)}...`);
    
    // Type text with small delay
    for (const char of text) {
        agent.write(char);
        await this.wait(10);
    }
    await this.ensureEnter(agent);
  }

  async onWorkerData(data: string) {
      if (!this.enabled) return;
      
      // If we see "No previous sessions found" it means resume failed.
      // This is handled in index.ts startWorker() now.
  }

  async askWatchdog() {
    this.log("Asking Watchdog for guidance (STATE MACHINE)...");

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot ask watchdog: agents not initialized");
      return;
    }

    try {
      this.waitingForResponse = true;
      this.retryCount = 0;
      this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;

      // Get lines and strip ANSI to clean up formatting tokens
      const rawContext = stripAnsi(this.worker.getLines(25));

      // Normalize whitespace
      let context = rawContext.replace(/\s+/g, ' ').trim();

      // STRICT SANITIZATION: Only allow printable ASCII (32-126)
      context = context.replace(/[^\x20-\x7E]/g, '');

      if (context.length > 1000) {
          context = "..." + context.substring(context.length - 1000);
      }

      const supervisedContext = context;

      // Get current state
      const currentState = this.supervisorState.getState();
      const stateContext = this.supervisorState.getContext();

      // Check backoff if in ERROR state
      if (currentState === 'ERROR') {
        const delay = this.supervisorState.getErrorBackoffDelay();
        const nextRetryAt = stateContext.stateEnteredAt + delay;
        if (Date.now() < nextRetryAt) {
          const remaining = Math.ceil((nextRetryAt - Date.now()) / 1000);
          this.log(`[StateMachine] Still in backoff period (${remaining}s remaining). Skipping askWatchdog.`);
          this.nextCheckTime = nextRetryAt;
          this.waitingForResponse = false;
          this.processing = false;
          return;
        }
      }

      this.log(`[StateMachine] Current state: ${currentState}`);

      // Build prompt context
      const promptContext: PromptContext = {
        state: currentState,
        supervisedContext,
        supervisedStatus: this.isGenerating(this.worker) ? 'busy' : 'idle',
        requiresInput: this.hasChoiceMenu(this.worker),
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

      this.log(`[StateMachine] Generated ${currentState} prompt, length: ${question.length} chars`);

      // Post the state-based question
      await this.post(this.watchdog, question);
      this.log("AskWatchdog complete.");
    } catch (e: any) {
        this.log(`Error in askWatchdog(): ${e.message}`);
        this.waitingForResponse = false;
    }
  }

  async processDecision(jsonString: string) {
    this.waitingForResponse = false;
    this.log(`Processing decision JSON length: ${jsonString.length}`);
    
    try {
       this.log(`Parsing JSON: ${jsonString}`);

       jsonString = jsonString.replace(/[\r\n]+/g, ' '); 

       const decision = JSON.parse(jsonString);
       
       if (decision.action) {
         // Attempt action through state machine
         const result = this.supervisorState.attemptAction(decision.action);

         if (result.success) {
           // Valid action - execute agent-specific side effects
           this.log(`[StateMachine] Executing ${decision.action.type} → ${result.newState}`);
           await this.executeActionSideEffects(decision.action);
           this.onStateChange?.();
         } else if (result.backoffActive) {
           this.log(`[StateMachine] Action rejected: ${result.error}`);
           // Just wait, next tick will handle backoff
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
       await this.retry(e.message);
    }
  }

  extractJson(text: string): string {
    // Robust extraction: Find last '}' and search backwards for matching '{'
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

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot execute action: agents not initialized");
      return;
    }

    if (action.type === 'send-prompt') {
        let textToSend = action.text || '';

        // If instruct flag is set, prepend the aimparency guidance
        if (action.instruct && INSTRUCT_TEXT) {
            this.log('Including aimparency instruction text');
            // Always append the specific instruction/question after the general instructions
            if (textToSend) {
                textToSend = `${INSTRUCT_TEXT}\n\n---\n\n${textToSend}`;
            } else {
                textToSend = INSTRUCT_TEXT;
            }
        }

        this.log(`Sending prompt to Worker: ${textToSend.substring(0, 100)}...`);
        await this.post(this.worker, textToSend);
        this.turnCount++;
    } else if (action.type === 'wrap-up') {
        this.log('Planning compaction after git commit...');
        this.compactPlanned = true;
        await this.post(this.worker, ActionPrompts.commit());
    } else if (action.type === 'compress') {
        if (!this.compactPlanned) {
            this.log('Compress requested without wrap-up plan. Converting to wrap-up first.');
            this.compactPlanned = true;
            await this.post(this.worker, ActionPrompts.commit());
            this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
            return;
        }
        this.log('Compressing worker context...');
        this.compactPlanned = false;
        await this.post(this.worker, '/compress');
    } else if (action.type === 'enter') {
        await this.ensureEnter(this.worker);
    } else if (action.type === 'select-option') {
        this.log(`Selecting option: ${action.number}`);
        await this.wait(70);
        this.worker.write(String(action.number));
        await this.wait(70);
    } else if (action.type === 'emergency-stop') {
        this.triggerEmergencyStop();
    } else if (action.type === 'stop') {
        this.compactPlanned = false;
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
       
       this.waitingForResponse = true;
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

    this.waitingForResponse = true;
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  // ========== STATE MACHINE METHODS ==========

  /**
   * Execute agent-specific side effects for an action
   * Note: State transition already happened in attemptAction()
   */
  async executeActionSideEffects(action: any): Promise<void> {
    const actionType = action.type;

    this.log(`[StateMachine] Executing side effects for "${actionType}"`);

    // Update context and execute side effects for each action
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
    const prompt = `${INSTRUCT_TEXT}\n\n---\n\n${ActionPrompts.startWork(message)}`;
    await this.post(this.worker, prompt);
    this.turnCount++;
  }

  private async executeBreakDown(message?: string): Promise<void> {
    this.log('[StateMachine] Breaking down work');
    await this.post(this.worker, ActionPrompts.breakDown(message));
    this.turnCount++;
  }

  private async executeIdeate(text?: string): Promise<void> {
    this.log('[StateMachine] Ideating');
    await this.post(this.worker, ActionPrompts.ideate(text));
    this.turnCount++;
  }

  private async executeTextPrompt(text?: string): Promise<void> {
    await this.post(this.worker, ActionPrompts.textPrompt(text));
    this.turnCount++;
  }

  private async executeVerify(text?: string): Promise<void> {
    this.supervisorState.updateContext({ metadata: { workSummary: text || 'verify that more than 80% of the tackled requirements have been met. If the work is good enough, prepare to update the aim via Aimparency MCP.' } });
    await this.post(this.worker, ActionPrompts.verify(text));
    this.turnCount++;
  }

  private async executeRevisit(text?: string): Promise<void> {
    await this.post(this.worker, ActionPrompts.revisit(text));
    this.turnCount++;
  }

  private async executeWrapUp(text?: string): Promise<void> {
    await this.post(this.worker, ActionPrompts.wrapUp(text));
    this.turnCount++;
  }

  private async executeCommit(text?: string): Promise<void> {
    await this.post(this.worker, ActionPrompts.commit(text));
    this.turnCount++;
  }

  private async executeExplore(text?: string): Promise<void> {
    await this.post(this.worker, ActionPrompts.explore(text));
    this.turnCount++;
  }

  private async executeCompact(text?: string): Promise<void> {
    this.log('[StateMachine] Compacting worker context');
    if (text) {
        await this.post(this.worker, text);
        await this.wait(1000);
    }
    await this.post(this.worker, '/compress');
    this.turnCount = 0;
  }

  private async executeChoice(choice: string): Promise<void> {
    this.log(`[StateMachine] Executing choice: ${choice}`);
    await this.wait(70);
    this.worker.write(choice);
    await this.ensureEnter(this.worker);
  }
}
