import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import * as net from 'net';
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
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const args = process.argv.slice(2);

// Default configuration
let projectRootPath = path.resolve(__dirname, '../../../../');

// Codex model defaults
let workerModel: string | undefined;
let watchdogModel: string | undefined;

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

console.log("Starting Codex Agents...");
console.log(`Worker Project Root: ${PROJECT_ROOT}`);
console.log(`Worker Model: ${workerModel ?? "default"}`);
console.log(`Watchdog Model: ${watchdogModel ?? "default"}`);
console.log(`Compact Watchdog Context Every: ${compactEvery} turns`);

// Codex CLI args
const codexBaseArgs: string[] = [];
if (workerModel !== undefined) {
  codexBaseArgs.push('--model', workerModel);
}

let worker: Agent;
let watchdogService: WatchdogService | undefined;

function startWorker(resume: boolean) {
    if (worker) {
        try { worker.kill(); } catch(e) {}
    }

    const currentArgs = resume
      ? [...codexBaseArgs, 'resume', '--last']
      : [...codexBaseArgs];
    console.log(`Starting Codex worker (Resume: ${resume})...`);

    let relaunched = false;
    const relaunchFresh = () => {
      if (relaunched) return;
      relaunched = true;
      console.warn('[Worker] Resume failed. Restarting fresh...');
      startWorker(false);
      if (watchdogService) watchdogService.worker = worker;
    };

    worker = new Agent(PROJECT_ROOT, currentArgs, (data) => {
        if (resume && /(No sessions found|No session found|No previous sessions found|No conversation found|Could not find.*session)/i.test(data)) {
          relaunchFresh();
          return;
        }

        io.emit('worker-data', data);
        // Only forward to watchdog service if initialized
        if (watchdogService) watchdogService.onWorkerData(data);
    });

    worker.ptyProcess.onExit(({ exitCode }) => {
      if (resume && exitCode !== 0) {
        relaunchFresh();
      }
    });
}

startWorker(true);

// Watchdog Codex instance runs in kennel directory
const codexWatchdogArgs: string[] = [];
if (watchdogModel !== undefined) {
  codexWatchdogArgs.push('--model', watchdogModel);
}

const watchdog = new Agent(KENNEL_PATH, codexWatchdogArgs, (data) => {
  io.emit('watchdog-data', data);
});

watchdogService = new WatchdogService(worker!, watchdog, workerModel, compactEvery, PROJECT_ROOT);

watchdogService.onStop = (reason) => {
    console.log(`Watchdog stopped: ${reason}`);
    io.emit('watchdog-state', false);
};

watchdogService.onEmergencyStop = () => {
    io.emit('emergency-stop');
};

io.on('connection', (socket) => {
  console.log('WebUI Client connected');
  socket.emit('watchdog-state', watchdogService.enabled);
  socket.emit('emergency-state', watchdogService.emergencyStopped);

  socket.on('toggle-watchdog', (enabled: boolean) => {
    watchdogService.setEnabled(enabled);
    io.emit('watchdog-state', enabled);
    io.emit('emergency-state', watchdogService.emergencyStopped);
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
    console.log(`Codex Watchdog Server running at http://localhost:${PORT}`);

    // Only open browser if port was NOT manually specified (implies manual run vs managed run)
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
