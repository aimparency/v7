import { Agent } from './agent';

const POST_ACTION_COOLDOWN = 3000; 
const INITIAL_WAIT_AFTER_POST = 2000;
const IDLE_CHECK_INTERVAL = 500; 
const IDLE_DEBOUNCE_INTERVAL = 100;
const MAX_RETRIES = 5;
const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠏'];
const PROMPT_MARKER = "Respond ONLY with the raw JSON action object (single line, no markdown, no code blocks).";

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export class WatchdogService {
  worker!: Agent;
  watchdog!: Agent; // The agent formerly known as Supervisor
  
  enabled: boolean = false; 
  waitingForResponse: boolean = false;
  processing: boolean = false;
  retryCount: number = 0;
  
  clearEvery: number;
  turnCount: number = 0;
  expectedModel: string;

  private nextCheckTime = 0;

  constructor(worker: Agent, watchdog: Agent, expectedModel: string, clearEvery: number = 1) {
    this.worker = worker;
    this.watchdog = watchdog;
    this.expectedModel = expectedModel;
    this.clearEvery = clearEvery;
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
      this.turnCount = 0; // Reset turn count on enable? Or keep it? Reset feels safer.
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
      this.stop("Quota limit / model switch detected");
      if (this.onEmergencyStop) {
          this.onEmergencyStop();
      }
  }

  onWorkerData(data: string) {
    // Check for quota/model switch messages
    // Removed 'switch.*model' as it causes false positives (e.g. user text). 
    // We rely on the active LLM check for model verification.
    if (/(quota.*exceeded|insufficient.*quota)/i.test(data)) {
        this.triggerEmergencyStop();
    }

    if (this.enabled && !this.waitingForResponse) {
        this.nextCheckTime = Math.max(this.nextCheckTime, Date.now() + IDLE_CHECK_INTERVAL);
    }
  }

  async tick() {
    if (!this.enabled) return;
    if (this.processing) return;
    if (Date.now() < this.nextCheckTime) return;

    this.processing = true;
    // this.log("Tick processing started.");

    try {
      // Check Watchdog Response
      if (this.waitingForResponse) {
        // ... (existing response handling code) ...
        // Check for idle
        const isIdle = await this.waitForIdle(this.watchdog);
        
        if (!isIdle) {
          // this.log("Watchdog still generating (not idle). Waiting...");
          this.nextCheckTime = Date.now() + IDLE_CHECK_INTERVAL;
          this.processing = false;
          return;
        }

        // We are confident the watchdog is idle. Try to parse.
          
          const screenContent = this.watchdog.getLines(30); 
          const markerIndex = screenContent.lastIndexOf(PROMPT_MARKER);
          let contentToParse = screenContent;

          if (markerIndex !== -1) {
               contentToParse = screenContent.substring(markerIndex + PROMPT_MARKER.length).trim();
          }

          if (contentToParse.length === 0) {
               this.log("Watchdog idle but response content empty (or marker not found/nothing after marker). Waiting...");
               this.nextCheckTime = Date.now() + 500;
               this.processing = false;
               return;
          }

          try {
              this.log("Attempting to extract JSON...");
              const jsonString = this.extractJson(contentToParse); 
              this.log("JSON extracted. Processing decision...");
              await this.processDecision(jsonString);
          } catch (e) {
              this.log(`JSON extraction/parsing failed: ${e}. Content length: ${contentToParse.length}`);
              // console.debug("Failed content:", contentToParse); 
              this.nextCheckTime = Date.now() + 100; // Retry faster
          }
        this.processing = false;
        return;
      }

      // Check Worker Idle
      const isWorkerIdle = await this.waitForIdle(this.worker);
      
      if (isWorkerIdle) {
          // Check for context clear
          if (this.turnCount >= this.clearEvery) {
              this.log(`Turn count ${this.turnCount} reached limit ${this.clearEvery}. Clearing context.`);
              this.turnCount = 0;
              await this.post(this.watchdog, '/clear');
              this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
          } else {
              await this.askWatchdog(); // This sets waitingForResponse=true
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

  // Checks for idle state: No spinner/cancel for 5 consecutive checks of 100ms
  // Also checks that content hasn't changed
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
    const hasCancel = /esc to cancel|Cancelling/i.test(lastLine);
    return hasSpinner || hasCancel;
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async ensureInsertMode(agent: Agent) {
    await this.wait(70); // Initial wait
    agent.write('\x1b'); // ESC to Normal Mode
    await this.wait(70);
    agent.write('i');    // 'i' to Insert Mode
    await this.wait(70);
  }

  private async ensureEnter(agent: Agent): Promise<void> {
    await this.wait(70);
    agent.write('\r\n'); // Send Enter
    await this.wait(70);
  }

  private async post(agent: Agent, text: string): Promise<void> {
    this.log(`Posting text to agent... Length: ${text.length}`);
    await this.ensureInsertMode(agent);
    
    const chunkSize = 100;
    for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.substring(i, i + chunkSize);
        agent.write(chunk);
        await this.wait(50);
    }
    
    await this.wait(100);
    await this.ensureEnter(agent);
    this.log("Post complete.");
  }

  async askWatchdog() {
    this.log("Asking Watchdog for guidance...");
    this.waitingForResponse = true;
    this.retryCount = 0;
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST; 
    
    // Get lines and strip ANSI to clean up formatting tokens
    const rawContext = stripAnsi(this.worker.getLines(40));

    // Normalize whitespace: collapse all whitespace sequences (newlines, tabs, multiple spaces) to a single space
    // and trim edges.
    const context = rawContext.replace(/\s+/g, ' ').trim();
    
    const question = `
You are observing a code assistant cli. 
Decide what action to take (prompt, choose option, stop - as defined in .gemini/GEMINI.md). 

This is the current situation: 
=== 
${context} 
=== 

What shall we do about this situation?

Check the model that is being used in the main agent: it's usually the last word of the context. It MUST be '${this.expectedModel}'. If it is not, return { "action": { "type": "stop", "reason": "model-switch" } }. 

${PROMPT_MARKER}
`;
    
    // Ensure the entire prompt is a single line
    const singleLineQuestion = question.replace(/\s+/g, ' ').trim();
    
    await this.post(this.watchdog, singleLineQuestion);
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

    if (action.type === 'send-prompt') {
        this.log(`Sending prompt to Worker: ${action.text}`);
        await this.post(this.worker, action.text);
        this.turnCount++;
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
        const reason = action.reason || 'Requested by Supervisor';
        this.stop(reason);
    }
    this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
  }

  async retry(error: string) {
     this.retryCount++;
     if (this.retryCount < MAX_RETRIES) {
       this.log(`Retrying watchdog request (Count: ${this.retryCount}). Error: ${error}`);
       const retryMessage = `ERROR: Invalid JSON. Error: ${error}. Retry JSON.`;
       await this.post(this.watchdog, retryMessage);
       
       this.waitingForResponse = true;
       this.nextCheckTime = Date.now() + INITIAL_WAIT_AFTER_POST;
     } else {
       console.error(`[WatchdogService] Max retries (${MAX_RETRIES}) reached. Halting.`);
       this.worker.write('\x03'); 
       this.watchdog.write('\x03');
       process.exit(1);
     }
  }
}
