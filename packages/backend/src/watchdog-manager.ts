import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface WatchdogInstance {
  process: ChildProcess;
  port: number;
  projectPath: string;
  lastKeepalive: number;
  checkInterval: NodeJS.Timeout;
}

const instances = new Map<string, WatchdogInstance>();
const KEEPALIVE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Utility to find a free port
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

export const WatchdogManager = {
  async start(projectPath: string): Promise<{ port: number, pid: number }> {
    // Check if already running
    const existing = instances.get(projectPath);
    if (existing) {
      if (existing.process.exitCode === null) {
        // Update keepalive since we are requesting it
        existing.lastKeepalive = Date.now();
        return { port: existing.port, pid: existing.process.pid! };
      } else {
        // Clean up dead process
        clearInterval(existing.checkInterval);
        instances.delete(projectPath);
      }
    }

    // Find free port starting from 4100
    // Note: Watchdog's own finding logic starts at 4011. 
    // We want to control it, so we pick one here.
    // To avoid collisions with manually started watchdogs, let's start at 4200.
    const port = await findAvailablePort(4200);

    // Resolve path to watchdog executable
    // Backend runs from packages/backend/src (dev) or dist (prod)
    // Watchdog is at root/watchdog/dist/index.js
    // Assuming backend is at packages/backend
    // Relative: ../../watchdog/dist/index.js
    
    // Adjust path based on execution context (ts-node vs node dist)
    // __dirname in ts-node (src): .../packages/backend/src
    // __dirname in build (dist): .../packages/backend/dist
    // Target: .../watchdog/dist/index.js
    
    const rootDir = path.resolve(__dirname, '../../..'); // Up to project root
    const watchdogScript = path.join(rootDir, 'packages/watchdog/dist/index.js');

    console.log(`[WatchdogManager] Spawning watchdog on port ${port} for ${projectPath}`);
    console.log(`[WatchdogManager] Script: ${watchdogScript}`);

    // Ensure we pass the PROJECT ROOT to the watchdog, not the .bowman dir
    // The watchdog script uses this path as the CWD for the worker (Gemini agent).
    // Gemini agent expects to run in the project root.
    const projectRoot = projectPath.endsWith('.bowman') || projectPath.endsWith('.bowman/')
        ? path.dirname(projectPath) 
        : projectPath;

    const child = spawn('node', [watchdogScript, '--port', String(port), projectRoot], {
      cwd: rootDir,
      stdio: 'inherit', // Pipe logs to main backend logs for now
      env: { ...process.env }
    });

    const checkInterval = setInterval(() => {
      const instance = instances.get(projectPath);
      if (instance) {
        if (Date.now() - instance.lastKeepalive > KEEPALIVE_TIMEOUT) {
          console.log(`[WatchdogManager] Timeout for ${projectPath}, killing process.`);
          instance.process.kill();
          clearInterval(instance.checkInterval);
          instances.delete(projectPath);
        }
      } else {
        clearInterval(checkInterval);
      }
    }, 30 * 1000); // Check every 30 seconds

    instances.set(projectPath, {
      process: child,
      port,
      projectPath,
      lastKeepalive: Date.now(),
      checkInterval
    });

    child.on('exit', (code) => {
      console.log(`[WatchdogManager] Watchdog for ${projectPath} exited with code ${code}`);
      const instance = instances.get(projectPath);
      if (instance?.process === child) {
        clearInterval(instance.checkInterval);
        instances.delete(projectPath);
      }
    });

    return { port, pid: child.pid! };
  },

  stop(projectPath: string): boolean {
    const instance = instances.get(projectPath);
    if (instance && instance.process.exitCode === null) {
      instance.process.kill();
      clearInterval(instance.checkInterval);
      instances.delete(projectPath);
      return true;
    }
    return false;
  },

  keepalive(projectPath: string): boolean {
    const instance = instances.get(projectPath);
    if (instance && instance.process.exitCode === null) {
      instance.lastKeepalive = Date.now();
      return true;
    }
    return false;
  },

  getStatus(projectPath: string): { running: boolean, port?: number } {
    const instance = instances.get(projectPath);
    if (instance && instance.process.exitCode === null) {
      // Status check also acts as a keepalive? 
      // User said "frontend should send keepalive every 30s".
      // Let's assume explicit keepalive is preferred, but status might imply interest.
      // For now, let's keep getStatus read-only regarding keepalive to avoid accidental keeps.
      return { running: true, port: instance.port };
    }
    return { running: false };
  }
};
