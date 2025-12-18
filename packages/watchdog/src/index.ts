import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import * as net from 'net';
import { Agent } from './agent';
import { WatchdogService } from './watchdog';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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

app.use(express.static(path.join(__dirname, '../webui/dist')));

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

let workerModel = 'Auto (Gemini 3)'; 
let watchdogModel = 'Auto (Gemini 3)'; 

let clearEvery = 20;

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

  } else if (arg === '--clear-every') {

    if (args[i + 1]) {

      clearEvery = parseInt(args[i + 1], 10);

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



console.log("Starting Agents Immediately...");

console.log(`Worker Project Root: ${PROJECT_ROOT}`);

console.log(`Worker Model: ${workerModel}`);

console.log(`Watchdog Model: ${watchdogModel}`);

console.log(`Clear Context Every: ${clearEvery} turns`);



const worker = new Agent(PROJECT_ROOT, ['--resume', 'latest', '--approval-mode', 'auto_edit', '--model', workerModel], (data) => {

  io.emit('worker-data', data);

  watchdogService.onWorkerData(data);

});



// Renamed from supervisor to watchdog

const watchdog = new Agent(KENNEL_PATH, ['--model', watchdogModel], (data) => {

  io.emit('watchdog-data', data); // Changed event name to watchdog-data

  // We don't need to feed data to WatchdogService anymore, it reads from terminal

});



const watchdogService = new WatchdogService(worker, watchdog, workerModel, clearEvery);



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

    io.emit('emergency-state', watchdogService.emergencyStopped); // Sync state

  });

  

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
