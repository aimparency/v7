import { Agent } from './agent';
import * as fs from 'fs';
import * as path from 'path';
import { SessionMemory } from './session-memory';
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
const DEBUG_WATCHDOG = process.env.DEBUG_WATCHDOG === 'true';
// Spinner characters used by the CLI
const SPINNER_CHARS = ['✻', '·', '✢', '○', '◎', '●', '◯'];

const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export class WatchdogService {
  worker!: Agent;
  watchdog!: Agent;

  enabled: boolean = false;
  waitingForResponse: boolean = false;
  waitingForResponseStart: boolean = false;
  responseRequestedAt: number = 0;
  responseSawGenerating: boolean = false;
  responseStartContent?: string;
  processing: boolean = false;
  retryCount: number = 0;
  markerNotFoundCount: number = 0;

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;
  autonomyPolicy: AutonomyPolicy;

  private nextCheckTime = 0;
  private busyStartedAt = 0;
  private watchdogBusyStartedAt = 0;
  private sessionMemory: SessionMemory | null = null;
  private instructTextWithMemory: string = INSTRUCT_TEXT;
  private compactPlanned = false;
  private supervisorState: SupervisorState = new SupervisorState();
  private projectPath?: string;

  constructor(worker: Agent, watchdog: Agent, expectedModel: string | undefined, compactEvery: number = 1, projectPath?: string, autonomyPolicy: AutonomyPolicy = {}) {
    this.projectPath = projectPath;
    this.worker = worker;
    this.watchdog = watchdog;
    this.expectedModel = expectedModel;
    this.compactEvery = compactEvery;
    this.autonomyPolicy = autonomyPolicy;

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
    if (DEBUG_WATCHDOG) {
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
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.responseRequestedAt = 0;
      this.responseSawGenerating = false;
      this.responseStartContent = undefined;
      this.processing = false;
      this.nextCheckTime = Date.now() + 500;
      this.turnCount = 0;
      this.busyStartedAt = 0;
      this.watchdogBusyStartedAt = 0;
      this.compactPlanned = false;
      this.lastStopReason = '';
    } else {
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.responseStartContent = undefined;
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
      this.waitingForResponseStart = false;
      this.responseStartContent = undefined;
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
      // 1. Handle "Waiting for response to START"
      if (this.waitingForResponseStart) {
        const currentContent = this.watchdog.getLines(50);
        const clean = (s: string) => s.replace(/\s/g, '');
        const currentClean = clean(currentContent);
        const startClean = clean(this.responseStartContent || '');
        const contentChanged = startClean !== '' && currentClean !== startClean;

        const watchdogGenerating = this.isGenerating(this.watchdog) || contentChanged;
        if (watchdogGenerating) {
          this.log(`DEBUG: Watchdog started generating (generating: ${this.isGenerating(this.watchdog)}, contentChanged: ${contentChanged}).`);
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.responseSawGenerating = true;
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        const elapsedSinceRequest = Date.now() - this.responseRequestedAt;
        if (elapsedSinceRequest > 60000) { // 60 seconds start timeout
          this.log(`DEBUG: Watchdog failed to start response within 60000ms. Retrying.`);
          this.waitingForResponseStart = false;
          await this.retry("Watchdog failed to start responding");
          this.processing = false;
          return;
        }

        this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
        this.processing = false;
        return;
      }

      // 2. Check Watchdog Response
      if (this.waitingForResponse) {
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
        const screenContent = this.watchdog.getLines(500); 
        this.log(`DEBUG: Looking for marker: "${PROMPT_MARKER}"`);
        const markerIndex = screenContent.lastIndexOf(PROMPT_MARKER);
        let contentToParse = "";

        if (markerIndex !== -1) {
             contentToParse = screenContent.substring(markerIndex + PROMPT_MARKER.length).trim();
             this.markerNotFoundCount = 0;
        } else {
             this.markerNotFoundCount++;
             this.log(`PROMPT_MARKER not found in watchdog output. Waiting... (${this.markerNotFoundCount})`);
             if (this.markerNotFoundCount >= 10) {
                this.log("PROMPT_MARKER not found after 10 checks — re-asking watchdog.");
                this.markerNotFoundCount = 0;
                this.waitingForResponse = false;
             }
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
            if (e.message && e.message.includes("No JSON closing brace found")) {
                this.log("No JSON closing brace found yet. Watching for more output...");
                this.nextCheckTime = Date.now() + 1000;
                this.processing = false;
                return;
            }
            await this.retry(e.message || "JSON extraction failed");
            return; 
        }
        this.processing = false;
        return;
      }

      // Check Worker Idle
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
    let previousContent = this.readAgentLines(agent, 30);

    if (this.isGenerating(agent)) return false;

    for (let i = 0; i < 5; i++) {
      await this.wait(100);
      if (this.isGenerating(agent)) return false;

      const currentContent = this.readAgentLines(agent, 30);
      if (currentContent !== previousContent) {
        return false;
      }
      previousContent = currentContent;
    }
    return true;
  }

  isGenerating(agent: Agent): boolean {
    const lines = this.readAgentLines(agent, 8);
    
    // Check for spinner characters (both custom ones and any Braille characters U+2800 to U+28FF)
    const lastLines = lines.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const lastLine = lastLines[lastLines.length - 1] || '';
    
    // Custom spinner characters check on the last line only to avoid false positives with dots/bullets
    const hasLastLineSpinner = SPINNER_CHARS.some(char => lastLine.includes(char));
    
    // Check for safe custom spinners anywhere in the last 8 lines (e.g. ✢ or ✻ when followed by other lines)
    const SAFE_HISTORICAL_SPINNER_CHARS = ['✻', '✢', '○', '◎', '◯'];
    const hasHistoricalSpinner = SAFE_HISTORICAL_SPINNER_CHARS.some(char => lines.includes(char));
    
    // Braille characters check anywhere in the last 8 lines (very safe and prevents missing transient/scrolled spinners)
    const hasBrailleSpinner = /[\u2800-\u28FF]/.test(lines);
    
    // Also check for common busy indicators
    const recentLines = stripAnsi(lines);
    const hasInterruptIndicator = /esc to interrupt/i.test(recentLines);
    const hasTimedCancelIndicator = /esc to cancel,\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i.test(recentLines);
    const hasClaudeBusyIndicator = /\/btw to ask/i.test(recentLines) || /interrupting Claude/i.test(recentLines);
    
    return hasLastLineSpinner || hasHistoricalSpinner || hasBrailleSpinner || hasInterruptIndicator || hasTimedCancelIndicator || hasClaudeBusyIndicator;
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

  async wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async post(agent: Agent, text: string) {
    this.log(`Posting to ${agent === this.worker ? 'Worker' : 'Watchdog'}: ${text.substring(0, 50)}...`);
    
    // Type text with small delay
    for (const char of text) {
        agent.write(char);
        await this.wait(10);
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

  async askWatchdog() {
    this.log("Asking Watchdog for guidance (STATE MACHINE)...");

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

    // Get lines and strip ANSI
    const rawContext = stripAnsi(this.worker.getLines(25));
    let context = rawContext.replace(/\s+/g, ' ').trim();
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
    this.responseStartContent = this.watchdog.getLines(50);
    this.log("AskWatchdog complete.");
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
        this.compactPlanned = true;
        await this.post(this.worker, ActionPrompts.commit());
    } else if (action.type === 'compact') {
        if (!this.compactPlanned) {
          this.log('Compact requested without wrap-up plan. Converting to wrap-up first.');
          this.compactPlanned = true;
          await this.post(this.worker, ActionPrompts.commit());
          this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
          return;
        }
        this.log(`Compacting worker context...`);
        this.compactPlanned = false;

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

        await this.post(this.worker, '/compact');
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
        this.responseStartContent = this.watchdog.getLines(50);
        
        this.waitingForResponseStart = true;
        this.waitingForResponse = false;
        this.responseRequestedAt = Date.now();
        this.responseSawGenerating = false;
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
    this.responseStartContent = this.watchdog.getLines(50);

    this.waitingForResponseStart = true;
    this.waitingForResponse = false;
    this.responseRequestedAt = Date.now();
    this.responseSawGenerating = false;
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
    const prompt = `${this.instructTextWithMemory}\n\n---\n\n${ActionPrompts.startWork(message)}`;
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
    await this.post(this.worker, '/compact');
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
