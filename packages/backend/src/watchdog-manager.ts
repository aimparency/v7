import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import * as net from 'net';

interface WatchdogInstance {
  process: ChildProcess;
  port: number;
  projectPath: string;
}

const instances = new Map<string, WatchdogInstance>();

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
        return { port: existing.port, pid: existing.process.pid! };
      } else {
        // Clean up dead process
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
    const watchdogScript = path.join(rootDir, 'watchdog/dist/index.js');

    console.log(`[WatchdogManager] Spawning watchdog on port ${port} for ${projectPath}`);
    console.log(`[WatchdogManager] Script: ${watchdogScript}`);

    const child = spawn('node', [watchdogScript, '--port', String(port), projectPath], {
      cwd: rootDir,
      stdio: 'inherit', // Pipe logs to main backend logs for now
      env: { ...process.env }
    });

    instances.set(projectPath, {
      process: child,
      port,
      projectPath
    });

    child.on('exit', (code) => {
      console.log(`[WatchdogManager] Watchdog for ${projectPath} exited with code ${code}`);
      if (instances.get(projectPath)?.process === child) {
        instances.delete(projectPath);
      }
    });

    return { port, pid: child.pid! };
  },

  stop(projectPath: string): boolean {
    const instance = instances.get(projectPath);
    if (instance && instance.process.exitCode === null) {
      instance.process.kill();
      instances.delete(projectPath);
      return true;
    }
    return false;
  },

  getStatus(projectPath: string): { running: boolean, port?: number } {
    const instance = instances.get(projectPath);
    if (instance && instance.process.exitCode === null) {
      return { running: true, port: instance.port };
    }
    return { running: false };
  }
};
