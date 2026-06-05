import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import cors from 'cors';
import { Agent } from './agent';
import { WatchdogService } from './watchdog';
import { SupervisorState, AutonomyPolicy } from '@aimparency/wrapped-agents-common';

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
  process.exit(1);
});

// A stray rejection must NOT kill the session
process.on('unhandledRejection', (reason, promise) => {
  console.error('[WARN] Unhandled Rejection (kept alive) at:', promise, 'reason:', reason);
  if (reason instanceof Error && reason.stack) {
    console.error(reason.stack);
  }
});

const args = process.argv.slice(2);

// Default configuration
let projectRootPath = path.resolve(__dirname, '../../../../');

// Default models for agy CLI (undefined uses the CLI defaults)
let workerModel: string | undefined = undefined;
let watchdogModel: string | undefined = undefined;

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
const AGENT_TYPE = 'agy' as const;

type RuntimeAgentState = {
  enabled: boolean;
  emergencyStopped: boolean;
  stopReason: string | null;
  updatedAt: number;
  supervisorState?: {
    state: string;
    color: string;
  } | null;
};

type WatchdogRuntimeState = {
  updatedAt: number;
  preferredAgentType: 'claude' | 'gemini' | 'codex' | 'agy' | null;
  agents: Partial<Record<'claude' | 'gemini' | 'codex' | 'agy', RuntimeAgentState>>;
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
      return { restoreSupervisorStateOnSessionRestart: true };
    }
    return JSON.parse(fs.readFileSync(policyPath, 'utf8')) as AutonomyPolicy;
  } catch (error) {
    console.warn('[Watchdog] Failed to read autonomy policy:', error);
    return { restoreSupervisorStateOnSessionRestart: true };
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
          updatedAt: Date.now(),
          supervisorState: service.getSupervisorStateInfo()
        }
      }
    };

    fs.mkdirSync(path.dirname(WATCHDOG_RUNTIME_STATE_PATH), { recursive: true });
    fs.writeFileSync(WATCHDOG_RUNTIME_STATE_PATH, JSON.stringify(next, null, 2));
  } catch (error) {
    console.warn('[Watchdog] Failed to persist runtime state:', error);
  }
}

console.log("Starting Antigravity (agy) Agents...");
console.log(`Worker Project Root: ${PROJECT_ROOT}`);
console.log(`Worker Model: ${workerModel ?? "default"}`);
console.log(`Watchdog Model: ${watchdogModel ?? "default"}`);
console.log(`Compact Watchdog Context Every: ${compactEvery} turns`);

// agy CLI args: --continue to resume, --dangerously-skip-permissions to auto-approve
const agyArgs = ['--continue', '--dangerously-skip-permissions'];
if (workerModel !== undefined) {
  agyArgs.push('--model', workerModel);
}

let worker: Agent;

function startWorker(resume: boolean) {
    if (worker) {
        try { worker.kill(); } catch(e) {}
    }

    const currentArgs = [...agyArgs];
    if (!resume) {
        const idx = currentArgs.indexOf('--continue');
        if (idx !== -1) {
            currentArgs.splice(idx, 1);
        }
    }

    console.log(`Starting agy worker (Resume: ${resume})...`);

    worker = new Agent(PROJECT_ROOT, currentArgs, (data) => {
        if (resume && (data.includes("No conversation found") || data.includes("No sessions found"))) {
            console.warn("[Worker] Resume failed (no session). Restarting fresh...");
            startWorker(false);
            if (watchdogService) watchdogService.worker = worker;
            return;
        }

        io.emit('worker-data', data);
        if (watchdogService) watchdogService.onWorkerData(data);
    });
}

startWorker(true);

// Watchdog agy instance runs in kennel directory
const agyWatchdogArgs: string[] = ['--dangerously-skip-permissions'];
if (watchdogModel !== undefined) {
  agyWatchdogArgs.push('--model', watchdogModel);
}

const watchdog = new Agent(KENNEL_PATH, agyWatchdogArgs, (data) => {
  io.emit('watchdog-data', data);
});

const autonomyPolicy = readAutonomyPolicy();
const watchdogService = new WatchdogService(worker!, watchdog, workerModel, compactEvery, PROJECT_ROOT, autonomyPolicy);
const existingRuntimeState = readWatchdogRuntimeState().agents[AGENT_TYPE];
if (existingRuntimeState) {
  watchdogService.lastStopReason = existingRuntimeState.stopReason ?? '';
  watchdogService.emergencyStopped = existingRuntimeState.emergencyStopped;
  if (existingRuntimeState.enabled && autonomyPolicy.restoreSupervisorStateOnSessionRestart !== false) {
    watchdogService.setEnabled(true);
  }
}
watchdogService.onStateChange = () => {
  persistWatchdogRuntimeState(watchdogService);
  io.emit('supervisor-state', watchdogService.getSupervisorStateInfo());
};
persistWatchdogRuntimeState(watchdogService);

watchdogService.onStop = (reason) => {
    console.log(`Watchdog stopped: ${reason}`);
    io.emit('watchdog-state', false);
    io.emit('watchdog-stop-reason', watchdogService.lastStopReason || reason);
    io.emit('supervisor-state', watchdogService.getSupervisorStateInfo());
};

watchdogService.onEmergencyStop = () => {
    io.emit('emergency-stop');
    io.emit('supervisor-state', watchdogService.getSupervisorStateInfo());
};

io.on('connection', (socket) => {
  console.log('WebUI Client connected');
  socket.emit('watchdog-state', watchdogService.enabled);
  socket.emit('emergency-state', watchdogService.emergencyStopped);
  if (!watchdogService.enabled) {
    socket.emit('watchdog-stop-reason', watchdogService.lastStopReason);
  }
  socket.emit('supervisor-state', watchdogService.getSupervisorStateInfo());
  socket.emit('worker-data', worker.getLines(1000));
  socket.emit('watchdog-data', watchdog.getLines(1000));

  socket.on('toggle-watchdog', (enabled: boolean) => {
    watchdogService.setEnabled(enabled);
    io.emit('watchdog-state', enabled);
    io.emit('emergency-state', watchdogService.emergencyStopped);
    if (!enabled) io.emit('watchdog-stop-reason', watchdogService.lastStopReason);
    io.emit('supervisor-state', watchdogService.getSupervisorStateInfo());
  });

  socket.on('worker-input', (data) => worker.write(data));
  socket.on('watchdog-input', (data) => watchdog.write(data));

  socket.on('resize-worker', ({ cols, rows }) => {
    worker.resize(cols, rows);
  });
  socket.on('resize-watchdog', ({ cols, rows }) => {
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
    console.log(`agy Watchdog Server running at http://localhost:${PORT}`);

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
