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

const POST_ACTION_COOLDOWN = 3000;
const INITIAL_WAIT_AFTER_POST = 2000;
const IDLE_CHECK_INTERVAL = 500;
const IDLE_DEBOUNCE_INTERVAL = 100;
const MAX_RETRIES = 5;
// Claude Code uses different spinner characters
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
  processing: boolean = false;
  retryCount: number = 0;

  compactEvery: number;
  turnCount: number = 0;
  expectedModel: string | undefined;

  private nextCheckTime = 0;

  constructor(worker: Agent, watchdog: Agent, expectedModel: string | undefined, compactEvery: number = 1) {
    this.worker = worker;
    this.watchdog = watchdog;
    this.expectedModel = expectedModel;
    this.compactEvery = compactEvery;
  }

  private log(msg: string) {
    console.log(`[${new Date().toISOString()}] [WatchdogService] ${msg}`);
  }

  emergencyStopped: boolean = false;
  onEmergencyStop?: () => void;
  onStop?: (reason: string) => void;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.emergencyStopped = false;
      this.nextCheckTime = Date.now() + 500;
      this.turnCount = 0;
    } else {
      this.waitingForResponse = false;
      this.processing = false;
    }
    this.log(`Logic ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  stop(reason: string) {
      if (!this.enabled) return;
      this.enabled = false;
      this.waitingForResponse = false;
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
    this.log("Asking Watchdog for guidance...");

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot ask watchdog: agents not initialized");
      return;
    }

    this.waitingForResponse = true;
    this.retryCount = 0;
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;

    const rawContext = stripAnsi(this.worker.getLines(40));
    const context = rawContext.replace(/\s+/g, ' ').trim();

    this.log(`DEBUG: Worker context length: ${context.length} chars`);
    this.log(`DEBUG: Worker context (first 200 chars): ${context.substring(0, 200)}`);

    const question = `You are supervising a Claude Code session. Look at what Claude is doing and decide the next action.

Current screen:
${context}

Actions available:
- send-prompt: Send text to Claude. Add "instruct": true if Claude seems idle/waiting for user input - this will prepend aimparency MCP usage instructions.
- select-option: Choose a numbered option (use when Claude presents choices)
- compact: Run /compact to free up context (use when "Context left until auto-compact" shows < 20%)
- stop: Stop supervision (use when ALL aims are done and verified complete)
- wait: Pause supervision briefly

IMPORTANT:
- If you see "Context left until auto-compact: X%" where X < 20%, use compact action BEFORE starting new work.
- Use "instruct": true when Claude asks "what should I do?" or seems to need direction.
- Only use stop when you've verified ALL open aims are complete (not just the current task).

Return a JSON object with your decision. Examples:
{"action": {"type": "send-prompt", "text": "continue working on aims", "instruct": true}}
{"action": {"type": "send-prompt", "text": "run the tests"}}
{"action": {"type": "select-option", "number": 1}}
{"action": {"type": "compact"}}
{"action": {"type": "stop", "reason": "all aims verified complete"}}

${PROMPT_MARKER}`;

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

  async executeAction(action: any) {
    this.log(`Executing Action: ${action.type}`);

    // Safety check
    if (!this.worker || !this.watchdog) {
      this.log("Cannot execute action: agents not initialized");
      return;
    }

    if (action.type === 'send-prompt') {
        let textToSend = action.text;

        // If instruct flag is set, prepend the aimparency guidance
        if (action.instruct && INSTRUCT_TEXT) {
            this.log('Including aimparency instruction text');
            textToSend = `${INSTRUCT_TEXT}\n\n---\n\n${action.text}`;
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

       this.waitingForResponse = true;
       this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
     } else {
       console.error(`[WatchdogService] Max retries (${MAX_RETRIES}) reached. Stopping Watchdog.`);
       this.stop(`Max retries (${MAX_RETRIES}) reached. JSON parsing failed repeatedly.`);
       // Do not kill the worker or exit process, just disable watchdog
     }
  }
}
