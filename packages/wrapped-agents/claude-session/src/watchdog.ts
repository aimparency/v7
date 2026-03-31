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
 * - WATCHDOG_IDLE_DEBOUNCE: Debounce interval for idle detection (default: 100ms)
 * - WATCHDOG_MAX_RETRIES: Maximum retries for JSON parsing failures (default: 5)
 * - DEBUG_WATCHDOG: Enable verbose debug logging (default: false, set to 'true' to enable)
 */
const POST_ACTION_COOLDOWN = parseInt(process.env.WATCHDOG_POST_ACTION_COOLDOWN || '3000', 10);
const INITIAL_WAIT_AFTER_POST = parseInt(process.env.WATCHDOG_INITIAL_WAIT || '2000', 10);
const IDLE_CHECK_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_CHECK_INTERVAL || '500', 10);
const IDLE_DEBOUNCE_INTERVAL = parseInt(process.env.WATCHDOG_IDLE_DEBOUNCE || '100', 10);
const MAX_RETRIES = parseInt(process.env.WATCHDOG_MAX_RETRIES || '5', 10);
const DEBUG_WATCHDOG = process.env.DEBUG_WATCHDOG === 'true';
// Claude Code uses different spinner characters
const SPINNER_CHARS = ['✻', '·', '✢', '○', '◎', '●', '◯'];
const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";
const WRAP_UP_PROMPT = "Before compacting, make a git commit for the work completed so far. Review git status, stage the intended files, create the commit, and then wait for /compact. If you need short guidance for the commit, ask explicitly.";

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

  private nextCheckTime = 0;
  private sessionMemory: SessionMemory | null = null;
  private instructTextWithMemory: string = INSTRUCT_TEXT;
  private compactPlanned = false;
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
      this.nextCheckTime = Date.now() + 500;
      this.turnCount = 0;
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
    if (this.enabled && !this.waitingForResponse) {
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
      // Check Watchdog Response
      if (this.waitingForResponse) {
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
        this.log(`DEBUG: Looking for marker: "${PROMPT_MARKER}"`);

        const markerIndex = screenContent.lastIndexOf(PROMPT_MARKER);
        let contentToParse: string;

        if (markerIndex !== -1) {
             this.log(`DEBUG: Marker found at index ${markerIndex}`);
             contentToParse = screenContent.substring(markerIndex + PROMPT_MARKER.length).trim();
             this.log(`DEBUG: Content after marker (first 300 chars): ${contentToParse.substring(0, 300)}`);
        } else {
             this.log("PROMPT_MARKER not found in watchdog output. Waiting...");
             this.nextCheckTime = Date.now() + 1000;
             this.processing = false;
             return;
        }

        // Look for Claude Code's output marker (● ) and extract after it
        const stripped = stripAnsi(contentToParse);
        const bulletIndex = stripped.lastIndexOf('●');
        if (bulletIndex !== -1) {
            contentToParse = stripped.substring(bulletIndex + 1).trim();
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
            this.log(`JSON extraction/parsing failed: ${e}. Content snippet: "${contentToParse.substring(0, 100)}"`);
            this.retry(e.message || "JSON extraction failed");
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
    const hasSpinner = SPINNER_CHARS.some(char => lastLine.includes(char));
    // Claude shows "ctrl+c to interrupt" when busy
    const hasBusyIndicator = /ctrl\+c to interrupt/i.test(lastLine);
    return hasSpinner || hasBusyIndicator;
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
    this.log(`Posting text to agent... Length: ${text.length}`);

    // Claude Code doesn't use vi modes - just write the text directly
    const chunkSize = 100;
    for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.substring(i, i + chunkSize);
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

    this.waitingForResponse = true;
    this.retryCount = 0;
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
      supervisedStatus: this.isGenerating(this.worker) ? 'busy' : 'idle'
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

    this.log(`[StateMachine] Generated ${currentState} prompt, length: ${question.length} chars`);
    this.log(`DEBUG: Question (first 500 chars):\n${question.substring(0, 500)}`);

    // Post the state-based question
    await this.post(this.watchdog, question);

    // Capture screen AFTER posting
    await this.wait(500);
    const screenAfter = this.watchdog.getLines(100);
    this.log(`DEBUG: Watchdog screen AFTER post (last 500 chars):\n${screenAfter.substring(Math.max(0, screenAfter.length - 500))}`);

    // Check if Claude is processing (showing spinners)
    const isProcessing = this.isGenerating(this.watchdog);
    this.log(`DEBUG: Is watchdog generating after post? ${isProcessing}`);
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

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot execute action: agents not initialized");
      return;
    }

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
        this.compactPlanned = true;
        await this.post(this.worker, WRAP_UP_PROMPT);
    } else if (action.type === 'compact') {
        if (!this.compactPlanned) {
          this.log('Compact requested without wrap-up plan. Converting to wrap-up first.');
          this.compactPlanned = true;
          await this.post(this.worker, WRAP_UP_PROMPT);
          this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
          return;
        }
        this.log(`Compacting worker context...`);
        this.compactPlanned = false;

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

  async urgeSupervisorToStickToJSONFormat(error: string) {
     this.retryCount++;
     if (this.retryCount < MAX_RETRIES) {
       this.log(`Urging supervisor to fix JSON (Count: ${this.retryCount}). Error: ${error}`);
       await this.wait(1000);
       const message = `ERROR: Invalid JSON. Error: ${error}. Retry with valid JSON.`;
       await this.post(this.watchdog, message);

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

    // Update context and execute side effects for each action
    switch (actionType) {
      case 'start_work':
        this.animatorState.startWork(action.task ?? 'current task', action.strategy, action.reference);
        await this.executeStartWork(action.task ?? 'current task', action.strategy, action.reference);
        break;

      case 'break_down':
        await this.executeBreakDown(action.focus ?? action.task ?? 'current task');
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

      case 'waiting_for_committed':
        this.log(`[StateMachine] Waiting for committed: ${action.reason || 'no reason'}`);
        this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
        return;

      case 'explore':
        await this.executeExplore(action.text);
        break;

      default:
        this.log(`[StateMachine] Unknown action type: ${actionType}`);
    }

    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  // ========== STATE MACHINE ACTION EXECUTORS ==========

  private async executeStartWork(task: string, strategy?: string, reference?: string): Promise<void> {
    this.log(`[StateMachine] Starting work on: ${task}`);

    const prompt = `${this.instructTextWithMemory}

---

Move into execution for this work:
- Focus: ${task}
${strategy ? `- Strategy: ${strategy}` : ''}
${reference ? `- Reference: ${reference}` : ''}

Use the project tools you have available. Start implementation, keep changes coherent, and surface blockers explicitly if you hit one.`;

    await this.post(this.worker, prompt);
  }

  private async executeBreakDown(focus: string): Promise<void> {
    this.log(`[StateMachine] Breaking down focus: ${focus}`);

    const prompt = focus
      ? `Break down the current high-level work into smaller concrete steps, then continue with the next best step. Current focus: ${focus}`
      : 'Break the current high-level work into smaller concrete steps, then continue with the next best step.';

    await this.post(this.worker, prompt);
  }

  private async executeIdeate(text?: string): Promise<void> {
    this.log('[StateMachine] Ideating');

    const defaultPrompt = 'Look for the next concrete task to start.';
    const prompt = text ? `${defaultPrompt} ${text}` : defaultPrompt;
    await this.post(this.worker, prompt);
  }

  private async executeTextPrompt(text?: string): Promise<void> {
    const prompt = text || 'Keep advancing the work.';
    await this.post(this.worker, prompt);
  }

  private async executeVerify(text?: string): Promise<void> {
    const defaultPrompt = 'verify that more than 80% of the tackled requirements have been met.';
    const prompt = text ? `${defaultPrompt} ${text}` : defaultPrompt;
    this.animatorState.updateContext({ metadata: { workSummary: text || defaultPrompt } });
    await this.post(this.worker, prompt);
  }

  private async executeRevisit(text?: string): Promise<void> {
    const prompt = text ? `finish implementation. ${text}` : 'finish implementation';
    await this.post(this.worker, prompt);
  }

  private async executeWrapUp(text?: string): Promise<void> {
    const defaultPrompt = 'update aim status and comment and reflection if not done already';
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
    const prompt = text || 'explore open aims and see if there is something you can work on';
    await this.post(this.worker, prompt);
  }
}
