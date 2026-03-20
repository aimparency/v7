import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import cors from 'cors';
import { Agent } from './agent';
import { WatchdogService } from './watchdog';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, () => {
      server.close(() => {
        resolve(startPort);
      });
    });
  });
}

app.use(express.static(path.join(__dirname, '../client/dist')));

// Centralized error handling
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  if (err instanceof Error && err.stack) {
      console.error(err.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  if (reason instanceof Error && reason.stack) {
      console.error(reason.stack);
  }
  process.exit(1);
});

const args = process.argv.slice(2);

// Default configuration

let projectRootPath = path.resolve(__dirname, '../../../../');

let workerModel: string | undefined; // 'gemini-3-pro'; 
let watchdogModel: string | undefined; // 'gemini-3-flash'; 

workerModel = 'gemini-3-pro-preview'
watchdogModel = 'gemini-3-flash-preview'

let compactEvery = 20;

let requestedPort = 0;



// Parse arguments

for (let i = 0; i < args.length; i++) {

  const arg = args[i];

  if (arg === '--worker-model') {

    if (args[i + 1]) {

      workerModel = args[i + 1];

      i++;

    }

  } else if (arg === '--watchdog-model') {

    if (args[i + 1]) {

      watchdogModel = args[i + 1];

      i++;

    }

  } else if (arg === '--model') {

    // Fallback for backward compatibility or simple usage -> applies to worker

    if (args[i + 1]) {

      workerModel = args[i + 1];

      i++;

    }

  } else if (arg === '--compact-every') {

    if (args[i + 1]) {

      compactEvery = parseInt(args[i + 1], 10);

      i++;

    }

  } else if (arg === '--port') {

    if (args[i + 1]) {

      requestedPort = parseInt(args[i + 1], 10);

      i++;

    }

  } else if (!arg.startsWith('-')) {

    projectRootPath = path.resolve(arg);

  }

}



const PROJECT_ROOT = projectRootPath;

const KENNEL_PATH = path.join(__dirname, '../kennel');
const PROJECT_AIMPARENCY_DIR = path.join(PROJECT_ROOT, '.bowman');
const WATCHDOG_RUNTIME_STATE_PATH = path.join(PROJECT_AIMPARENCY_DIR, 'runtime', 'watchdog-state.json');
const AGENT_TYPE = 'gemini' as const;

type RuntimeAgentState = {
  enabled: boolean;
  emergencyStopped: boolean;
  stopReason: string | null;
  updatedAt: number;
};

type WatchdogRuntimeState = {
  updatedAt: number;
  preferredAgentType: 'claude' | 'gemini' | 'codex' | null;
  agents: Partial<Record<'claude' | 'gemini' | 'codex', RuntimeAgentState>>;
};

type AutonomyPolicy = {
  restoreAnimatorStateOnSessionRestart?: boolean;
};

function readWatchdogRuntimeState(): WatchdogRuntimeState {
  try {
    if (!fs.existsSync(WATCHDOG_RUNTIME_STATE_PATH)) {
      return {
        updatedAt: 0,
        preferredAgentType: null,
        agents: {}
      };
    }

    return JSON.parse(fs.readFileSync(WATCHDOG_RUNTIME_STATE_PATH, 'utf8')) as WatchdogRuntimeState;
  } catch (error) {
    console.warn('[Watchdog] Failed to read runtime state:', error);
    return {
      updatedAt: 0,
      preferredAgentType: null,
      agents: {}
    };
  }
}

function readAutonomyPolicy(): AutonomyPolicy {
  try {
    const policyPath = path.join(PROJECT_AIMPARENCY_DIR, 'runtime', 'autonomy-policy.json');
    if (!fs.existsSync(policyPath)) {
      return { restoreAnimatorStateOnSessionRestart: true };
    }
    return JSON.parse(fs.readFileSync(policyPath, 'utf8')) as AutonomyPolicy;
  } catch (error) {
    console.warn('[Watchdog] Failed to read autonomy policy:', error);
    return { restoreAnimatorStateOnSessionRestart: true };
  }
}

function persistWatchdogRuntimeState(service: WatchdogService) {
  try {
    const current = readWatchdogRuntimeState();
    const next: WatchdogRuntimeState = {
      updatedAt: Date.now(),
      preferredAgentType: current.preferredAgentType ?? AGENT_TYPE,
      agents: {
        ...current.agents,
        [AGENT_TYPE]: {
          enabled: service.enabled,
          emergencyStopped: service.emergencyStopped,
          stopReason: service.lastStopReason || null,
          updatedAt: Date.now()
        }
      }
    };

    fs.mkdirSync(path.dirname(WATCHDOG_RUNTIME_STATE_PATH), { recursive: true });
    fs.writeFileSync(WATCHDOG_RUNTIME_STATE_PATH, JSON.stringify(next, null, 2));
  } catch (error) {
    console.warn('[Watchdog] Failed to persist runtime state:', error);
  }
}



console.log("Starting Agents Immediately...");

console.log(`Worker Project Root: ${PROJECT_ROOT}`);

console.log(`Worker Model: ${workerModel ?? "default"}`);

console.log(`Watchdog Model: ${watchdogModel ?? "default"}`);

console.log(`Compact Watchdog Context Every: ${compactEvery} turns`);


const geminiArgs = ['--resume', 'latest', '--approval-mode', 'auto_edit']
if(workerModel !== undefined) {
  geminiArgs.push('--model', workerModel)
}

let worker: Agent;

function startWorker(resume: boolean) {
    if (worker) {
        try { worker.kill(); } catch(e) {}
    }

    const currentArgs = [...geminiArgs];
    if (!resume) {
        const idx = currentArgs.indexOf('--resume');
        if (idx !== -1) {
            currentArgs.splice(idx, 2);
        }
    }

    console.log(`Starting worker (Resume: ${resume})...`);

    worker = new Agent(PROJECT_ROOT, currentArgs, (data) => {
        // Detect session resume failure
        if (resume && data.includes("No previous sessions found")) {
            console.warn("[Worker] Resume failed (no session). Restarting fresh...");
            startWorker(false);
            if (watchdogService) watchdogService.worker = worker;
            return;
        }

        io.emit('worker-data', data);
        // Only forward to watchdog service if initialized
        if (watchdogService) watchdogService.onWorkerData(data);
    });
}

startWorker(true);

// Renamed from supervisor to watchdog

const geminiWatchdogArgs: string[] = []
if(watchdogModel !== undefined) {
  geminiWatchdogArgs.push('--model', watchdogModel)
}

const watchdog = new Agent(KENNEL_PATH, geminiWatchdogArgs, (data) => {

  io.emit('watchdog-data', data); // Changed event name to watchdog-data

  // We don't need to feed data to WatchdogService anymore, it reads from terminal

});



const watchdogService = new WatchdogService(worker!, watchdog, workerModel, compactEvery);
const existingRuntimeState = readWatchdogRuntimeState().agents[AGENT_TYPE];
const autonomyPolicy = readAutonomyPolicy();
if (existingRuntimeState) {
  watchdogService.lastStopReason = existingRuntimeState.stopReason ?? '';
  watchdogService.emergencyStopped = existingRuntimeState.emergencyStopped;
  if (existingRuntimeState.enabled && autonomyPolicy.restoreAnimatorStateOnSessionRestart !== false) {
    watchdogService.setEnabled(true);
  }
}
watchdogService.onStateChange = () => {
  persistWatchdogRuntimeState(watchdogService);
};
persistWatchdogRuntimeState(watchdogService);



watchdogService.onStop = (reason) => {

    console.log(`Watchdog stopped: ${reason}`);

    io.emit('watchdog-state', false);
    io.emit('watchdog-stop-reason', watchdogService.lastStopReason || reason);

};



watchdogService.onEmergencyStop = () => {

    io.emit('emergency-stop');

};



io.on('connection', (socket) => {

  console.log('WebUI Client connected');

  socket.emit('watchdog-state', watchdogService.enabled);

  socket.emit('emergency-state', watchdogService.emergencyStopped);
  socket.emit('watchdog-stop-reason', watchdogService.lastStopReason);

  

  socket.on('toggle-watchdog', (enabled: boolean) => {

    watchdogService.setEnabled(enabled);

    io.emit('watchdog-state', enabled);

    io.emit('emergency-state', watchdogService.emergencyStopped); // Sync state
    io.emit('watchdog-stop-reason', watchdogService.lastStopReason);

  });

  // Send initial history
  socket.emit('worker-data', worker.getLines(1000));
  socket.emit('watchdog-data', watchdog.getLines(1000));

  

  socket.on('worker-input', (data) => worker.write(data));

  socket.on('watchdog-input', (data) => watchdog.write(data));

  

  socket.on('resize-worker', ({ cols, rows }) => {

    worker.resize(cols, rows);

  });

  socket.on('resize-watchdog', ({ cols, rows }) => { // Changed event name to resize-watchdog

    watchdog.resize(cols, rows);

  });

});



setInterval(() => {

  watchdogService.tick();

}, 500);



const cleanup = () => {
  console.log('[Watchdog] Received termination signal. Killing agents and closing server...');
  worker.kill();
  watchdog.kill();
  httpServer.close(() => {
    console.log('[Watchdog] Server closed. Exiting.');
    process.exit(0);
  });
  
  // Fallback exit if server.close takes too long
  setTimeout(() => {
    console.log('[Watchdog] Server close timed out. Forcing exit.');
    process.exit(1);
  }, 2000);
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);



(async () => {

  const PORT = requestedPort > 0 ? requestedPort : await findAvailablePort(4011);

  httpServer.listen(PORT, async () => {

    console.log(`Watchdog Server running at http://localhost:${PORT}`);

    // Only open browser if port was NOT manually specified (implies manual run vs managed run)

    // Or strictly if we are running in dev/standalone mode.

    // For now, let's keep opening it unless we add a --no-open flag, 

    // but managed mode usually runs headless. 

    // Let's assume managed mode uses --port and we shouldn't open browser then?

    // Actually, managed mode runs it in background. `open` might trigger on the server (headless).

    // Better to only open if NOT requestedPort?

    if (requestedPort === 0) {

        console.log("Opening WebUI in browser...");

        try {

        const openModule = await import('open');

        openModule.default(`http://localhost:${PORT}`);

        } catch (e) {

        console.log("Could not auto-open browser. Please open manually.");

        }

    }

  });

})();
