import { Agent } from './agent';
import * as fs from 'fs';
import * as path from 'path';

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
const DEBUG_WATCHDOG = process.env.DEBUG_WATCHDOG === 'true';
// Codex may render spinner-like characters depending on terminal mode
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
  processing: boolean = false;
  retryCount: number = 0;

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;

  private nextCheckTime = 0;
  private responseRequestedAt = 0;
  private currentPromptMarker: string = PROMPT_MARKER;
  private lastExecutedActionSignature = '';
  private lastExecutedActionAt = 0;

  constructor(worker: Agent, watchdog: Agent, expectedModel: string | undefined, compactEvery: number = 1) {
    this.worker = worker;
    this.watchdog = watchdog;
    this.expectedModel = expectedModel;
    this.compactEvery = compactEvery;
  }

  private log(msg: string) {
    // Only log DEBUG messages when DEBUG_WATCHDOG is enabled
    if (msg.startsWith('DEBUG:') && !DEBUG_WATCHDOG) {
      return;
    }
    console.log(`[${new Date().toISOString()}] [WatchdogService] ${msg}`);
  }

  emergencyStopped: boolean = false;
  onEmergencyStop?: () => void;
  onStop?: (reason: string) => void;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.emergencyStopped = false;
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.nextCheckTime = Date.now() + 500;
      this.turnCount = 0;
    } else {
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.processing = false;
    }
    this.log(`Logic ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  stop(reason: string) {
      if (!this.enabled) return;
      this.enabled = false;
      this.waitingForResponse = false;
      this.waitingForResponseStart = false;
      this.processing = false;
      this.log(`WATCHDOG STOPPED: ${reason}`);
      if (this.onStop) {
          this.onStop(reason);
      }
  }

  triggerEmergencyStop() {
      if (this.emergencyStopped) return;
      this.emergencyStopped = true;
      this.stop("Emergency stop triggered");
      if (this.onEmergencyStop) {
          this.onEmergencyStop();
      }
  }

  onWorkerData(data: string) {
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
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.log("DEBUG: Watchdog response started (busy indicator detected).");
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        const elapsed = Date.now() - this.responseRequestedAt;
        if (elapsed > RESPONSE_START_TIMEOUT) {
          // Fallback when busy indicator is not shown by terminal rendering.
          this.waitingForResponseStart = false;
          this.waitingForResponse = true;
          this.log(`DEBUG: Response start timeout (${RESPONSE_START_TIMEOUT}ms). Switching to response wait mode.`);
        } else {
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }
      }

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
    // Codex shows "esc to interrupt" while it is actively generating
    const hasBusyIndicator = /esc to interrupt/i.test(lastLine);
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
    this.log("Asking Watchdog for guidance...");

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot ask watchdog: agents not initialized");
      return;
    }

    this.waitingForResponseStart = true;
    this.waitingForResponse = false;
    this.retryCount = 0;
    this.responseRequestedAt = Date.now();
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;

    const rawContext = stripAnsi(this.worker.getLines(40));
    const context = rawContext.replace(/\s+/g, ' ').trim();

    this.log(`DEBUG: Worker context length: ${context.length} chars`);
    this.log(`DEBUG: Worker context (first 200 chars): ${context.substring(0, 200)}`);

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.currentPromptMarker = `${PROMPT_MARKER} [${requestId}]`;

    const question = `You are supervising a Codex session. Look at what Codex is doing and decide the next action.

Current screen:
${context}

Actions available:
- send-prompt: Send text to Codex. Add "instruct": true if Codex seems idle/waiting for user input - this will prepend aimparency MCP usage instructions.
- select-option: Choose a numbered option (use when Codex presents choices)
- compact: Run /compact to free up context
- stop: Stop supervision (use when ALL aims are done and verified complete)
- wait: Pause supervision briefly

IMPORTANT:
- IMPORTANT: Use compact action whenever Codex completes a significant chunk of work or is about to start looking for new work. This keeps context fresh and improves performance. (Be generous with returning compact). 
- Use "instruct": true when Codex asks "what should I do?" or seems to need direction.
- Only use stop when you've verified ALL open aims are complete (not just the current task).

Return a JSON object with your decision. Examples:
{"action": {"type": "send-prompt", "text": "continue working on aims", "instruct": true}}
{"action": {"type": "send-prompt", "text": "run the tests"}}
{"action": {"type": "select-option", "number": 1}}
{"action": {"type": "compact"}}
{"action": {"type": "stop", "reason": "all aims verified complete"}}

${this.currentPromptMarker}`;

    this.log(`DEBUG: Prepared question length: ${question.length} chars`);
    this.log(`DEBUG: Question (first 500 chars):\n${question.substring(0, 500)}`);
    this.log(`DEBUG: Question (last 200 chars):\n${question.substring(question.length - 200)}`);

    // Capture screen BEFORE posting
    const screenBefore = this.watchdog.getLines(50);
    this.log(`DEBUG: Watchdog screen BEFORE post (last 300 chars):\n${screenBefore.substring(Math.max(0, screenBefore.length - 300))}`);

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
         await this.executeAction(decision.action);
       }
    } catch (e: any) {
       this.log(`Error parsing JSON decision: ${e.message}`);
       this.retry(e.message);
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
    } else if (action.type === 'compact') {
        this.log(`Compacting worker context...`);
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
}
