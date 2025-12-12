const pty = require('node-pty');
const blessed = require('blessed');
const stripAnsi = require('strip-ansi');
const path = require('path');

// --- Configuration ---
const PROJECT_ROOT = path.resolve(__dirname, '../../..'); // Assuming running from subdev/agency/watchdog
const KENNEL_PATH = path.join(__dirname, 'kennel');
const WORKER_IDLE_TIMEOUT = 3000; // 3 seconds of silence to consider Worker idle
const SUPERVISOR_RESPONSE_STABILIZATION_TIMEOUT = 500; // Time after last output to consider supervisor done if no spinner
const MAX_SUPERVISOR_RETRIES = 5;

// Spinner characters provided by user
const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠏'];

// --- Blessed TUI Setup ---
const screen = blessed.screen({
  smartCSR: true,
  title: 'Aimparency Watchdog',
  sendFocus: true,
});

screen.key(['escape', 'C-c'], function(ch, key) {
  process.exit(0);
});

// Worker Pane (Top 2/3)
const workerBox = blessed.box({
  top: '0%',
  left: '0%',
  width: '100%',
  height: '66%',
  label: ' Worker (Aimparency CLI) ',
  border: { type: 'line' },
  style: {
    fg: 'white',
    bg: 'black',
    border: { fg: 'cyan' },
    label: { fg: 'cyan' },
  },
});

// Supervisor Pane (Bottom 1/3)
const supervisorBox = blessed.box({
  top: '66%',
  left: '0%',
  width: '100%',
  height: '34%',
  label: ' Supervisor (Watchdog Brain) ',
  border: { type: 'line' },
  style: {
    fg: 'white',
    bg: 'black',
    border: { fg: 'magenta' },
    label: { fg: 'magenta' },
  },
});

screen.append(workerBox);
screen.append(supervisorBox);

// Create actual terminal instances for the PTYs
const workerTerm = blessed.terminal({
  parent: workerBox,
  top: 0,
  left: 0,
  width: '100%-2', // Account for border
  height: '100%-2',
  cursorBlink: true,
  scrollback: 1000,
  style: { fg: 'white', bg: 'black' }
});

const supervisorTerm = blessed.terminal({
  parent: supervisorBox,
  top: 0,
  left: 0,
  width: '100%-2',
  height: '100%-2',
  cursorBlink: true,
  scrollback: 1000,
  style: { fg: 'white', bg: 'black' }
});

screen.render();

// --- PTY Spawning ---

// Worker (The Main Gemini Agent)
const workerPty = pty.spawn('gemini', [], {
  name: 'xterm-color',
  cols: workerTerm.width,
  rows: workerTerm.height,
  cwd: PROJECT_ROOT,
  env: process.env
});

// Supervisor (The Watchdog Brain)
const supervisorPty = pty.spawn('gemini', [], {
  name: 'xterm-color',
  cols: supervisorTerm.width,
  rows: supervisorTerm.height,
  cwd: KENNEL_PATH,
  env: process.env
});

// --- Buffering and State ---
let workerOutputBuffer = '';
let supervisorOutputBuffer = '';
let lastWorkerActivity = Date.now();
let lastSupervisorActivity = Date.now();
let waitingForSupervisorResponse = false;
let supervisorRetryCount = 0;
let watchdogProcessing = false; // Prevent re-entry

// --- Helper Functions ---
function isGeminiGenerating(buffer) {
  const cleanLastLine = stripAnsi(buffer).split('\n').pop() || '';
  const hasSpinner = SPINNER_CHARS.some(char => cleanLastLine.includes(char));
  const hasCancelMsg = /esc to cancel/i.test(cleanLastLine);
  return hasSpinner || hasCancelMsg;
}

// --- Event Handlers ---

workerPty.on('data', (data) => {
  workerTerm.write(data);
  workerOutputBuffer += data;
  lastWorkerActivity = Date.now();
});

supervisorPty.on('data', (data) => {
  supervisorTerm.write(data);
  supervisorOutputBuffer += data;
  lastSupervisorActivity = Date.now();
});

// Handle resize events
screen.on('resize', () => {
  workerPty.resize(workerTerm.width, workerTerm.height);
  supervisorPty.resize(supervisorTerm.width, supervisorTerm.height);
  screen.render();
});

// --- Watchdog Logic ---
setInterval(async () => {
  if (watchdogProcessing) return; // Prevent concurrent processing

  // Check if Supervisor is still generating or processing its thoughts
  if (waitingForSupervisorResponse) {
    if (!isGeminiGenerating(supervisorOutputBuffer) && (Date.now() - lastSupervisorActivity > SUPERVISOR_RESPONSE_STABILIZATION_TIMEOUT)) {
      // Supervisor has stopped generating and output has stabilized
      watchdogProcessing = true;
      await processSupervisorResponse();
      watchdogProcessing = false;
    }
    return; // Wait for supervisor if it's still generating or we're processing its response
  }

  // Check Worker for idle/prompts
  const workerSilence = Date.now() - lastWorkerActivity;
  const cleanWorkerOutput = stripAnsi(workerOutputBuffer);
  
  const isWorkerPrompt = cleanWorkerOutput.match(/\?.*(\(|\s)Y\/n(\)|\s)|\n>\s*$/i); // Detects "?" or ">" prompt
  
  if (workerSilence > WORKER_IDLE_TIMEOUT && isWorkerPrompt) {
    watchdogProcessing = true;
    // Log to a file instead of console because blessed owns stdout
    // fs.appendFileSync('watchdog.log', '[Watchdog] Worker is idle/prompted. Asking Supervisor...\n');
    
    waitingForSupervisorResponse = true;
    supervisorRetryCount = 0;
    
    const supervisorQuestion = `You are observing a code assistant cli. Decide what action to take (prompt, choose option, stop - as defined in .gemini/GEMINI.md). This is the current situation: ===\n${cleanWorkerOutput.split('\n').slice(-20).join('\n')}\n=== respond only with the JSON object as text, single line. No code block to avoid rendering with line numbers.`;
    
    supervisorPty.write(supervisorQuestion + '\r'); // Send question to Supervisor
    supervisorOutputBuffer = ''; // Clear buffer for new supervisor response
    watchdogProcessing = false;
  }
}, 500); // Check more frequently to catch prompts and spinner changes

async function processSupervisorResponse() {
  waitingForSupervisorResponse = false; // Acknowledge response
  
  const cleanSupervisorOutput = stripAnsi(supervisorOutputBuffer);
  let jsonString = '';

  // Try to extract the last JSON object from the buffer
  try {
    const lastOpenBrace = cleanSupervisorOutput.lastIndexOf('{');
    const lastCloseBrace = cleanSupervisorOutput.lastIndexOf('}');
    
    if (lastOpenBrace !== -1 && lastCloseBrace !== -1 && lastCloseBrace > lastOpenBrace) {
      jsonString = cleanSupervisorOutput.substring(lastOpenBrace, lastCloseBrace + 1);
    } else {
      throw new Error('No JSON object found in Supervisor output.');
    }
    
    const supervisorDecision = JSON.parse(jsonString);

    if (supervisorDecision.action) {
      // Log action (could write to file)
      
      let inputToSend = '';
      switch (supervisorDecision.action.type) {
        case 'enter':
          inputToSend = '\r';
          break;
        case 'select-option':
          inputToSend = `${supervisorDecision.action.number}\r`;
          break;
        case 'send-prompt':
          inputToSend = `${supervisorDecision.action.text}\r`;
          break;
        case 'stop':
          // Clean shutdown
          workerPty.kill();
          supervisorPty.kill();
          screen.destroy(); // Restore terminal
          const reason = supervisorDecision.action.reason || 'Unknown';
          console.log('\x1b[33m%s\x1b[0m', `Watchdog Stopped. Reason: ${reason}`); // Yellow text
          process.exit(0);
          break;
        default:
          throw new Error('Unknown action type from Supervisor.');
      }
      
      workerPty.write(inputToSend); // Send action to Worker
      workerOutputBuffer = ''; // Clear worker buffer after action
      supervisorOutputBuffer = ''; // Clear supervisor buffer
      lastWorkerActivity = Date.now(); // Reset worker timer
    } else {
      throw new Error('Supervisor JSON missing "action" field.');
    }
  } catch (e) {
    // Error handling (logging to file recommended)
    supervisorRetryCount++;
    if (supervisorRetryCount < MAX_SUPERVISOR_RETRIES) {
      const retryMessage = `ERROR: Invalid JSON from you. Please respond ONLY with valid JSON. Error: ${e.message}. Your last attempt outputted: \n---\n${jsonString}\n---\nPlease retry.`;
      supervisorPty.write(retryMessage + '\r'); // Send retry instruction to Supervisor
      waitingForSupervisorResponse = true; // Stay in waiting state
      supervisorOutputBuffer = ''; // Clear buffer for new attempt
    } else {
      workerPty.write('\x03'); // Send Ctrl+C to worker
      supervisorPty.write('\x03'); // Send Ctrl+C to supervisor
      process.exit(1);
    }
  }
}

// Ensure processes are killed on exit
process.on('exit', () => {
  workerPty.kill();
  supervisorPty.kill();
});