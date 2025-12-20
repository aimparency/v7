import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface WatchdogInstance {
  process?: ChildProcess;
  pid: number;
  port: number;
  projectPath: string;
  lastKeepalive: number;
  checkInterval: NodeJS.Timeout;
}

const instances = new Map<string, WatchdogInstance>();
const KEEPALIVE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const SESSIONS_FILE = path.join(__dirname, '../../watchdog-sessions.json');

// Persistence Helpers
function saveSessions() {
  const data = Array.from(instances.values()).map(i => ({
    pid: i.pid,
    port: i.port,
    projectPath: i.projectPath,
    lastKeepalive: i.lastKeepalive
  }));
  try {
    fs.writeJsonSync(SESSIONS_FILE, data);
  } catch (e) {
    console.error('[WatchdogManager] Failed to save sessions:', e);
  }
}

function killInstance(instance: WatchdogInstance) {
  console.log(`[WatchdogManager] Killing instance for ${instance.projectPath} (PID ${instance.pid})`);
  try {
    if (instance.process) {
      instance.process.kill();
    } else {
      process.kill(instance.pid);
    }
  } catch(e) {
    // Ignore error if already dead
  }
  
  clearInterval(instance.checkInterval);
  instances.delete(instance.projectPath);
  saveSessions();
}

function checkTimeout(projectPath: string) {
  const instance = instances.get(projectPath);
  if (instance) {
    const elapsed = Date.now() - instance.lastKeepalive;
    if (elapsed > KEEPALIVE_TIMEOUT) {
      console.log(`[WatchdogManager] Timeout for ${projectPath}. Elapsed: ${elapsed}ms > Limit: ${KEEPALIVE_TIMEOUT}ms. Killing process.`);
      killInstance(instance);
    }
  }
}

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readJsonSync(SESSIONS_FILE);
      console.log(`[WatchdogManager] Loading ${data.length} sessions from file.`);
      
      data.forEach((s: any) => {
        // Check if alive
        try {
          process.kill(s.pid, 0);
          
          // Check if timed out while we were away
          if (Date.now() - s.lastKeepalive > KEEPALIVE_TIMEOUT) {
             console.log(`[WatchdogManager] Reclaimed session for ${s.projectPath} (PID ${s.pid}) is expired. Killing.`);
             try { process.kill(s.pid); } catch(e){}
             return;
          }

          console.log(`[WatchdogManager] Reclaiming session for ${s.projectPath} (PID ${s.pid})`);
          
          const checkInterval = setInterval(() => {
            checkTimeout(s.projectPath);
          }, 30 * 1000);

          instances.set(s.projectPath, {
            pid: s.pid,
            port: s.port,
            projectPath: s.projectPath,
            lastKeepalive: s.lastKeepalive,
            checkInterval
          });
        } catch (e) {
          console.log(`[WatchdogManager] Session for ${s.projectPath} (PID ${s.pid}) is dead.`);
        }
      });
    }
  } catch (e) {
    console.error('[WatchdogManager] Failed to load sessions:', e);
  }
}

// Load on startup
loadSessions();

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
        // Verify liveness
        try {
            if (existing.process) {
                if (existing.process.exitCode !== null) throw new Error("Exited");
            } else {
                process.kill(existing.pid, 0);
            }
            
            existing.lastKeepalive = Date.now();
            saveSessions();
            return { port: existing.port, pid: existing.pid };
        } catch (e) {
            console.log(`[WatchdogManager] Existing instance dead, cleaning up.`);
            killInstance(existing);
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
        checkTimeout(projectPath);
    }, 30 * 1000); // Check every 30 seconds

    instances.set(projectPath, {
      process: child,
      pid: child.pid!,
      port,
      projectPath,
      lastKeepalive: Date.now(),
      checkInterval
    });
    
    saveSessions();

    child.on('exit', (code) => {
      console.log(`[WatchdogManager] Watchdog for ${projectPath} exited with code ${code}`);
      const instance = instances.get(projectPath);
      if (instance?.process === child) {
        clearInterval(instance.checkInterval);
        instances.delete(projectPath);
        saveSessions();
      }
    });

    return { port, pid: child.pid! };
  },

  stop(projectPath: string): boolean {
    const instance = instances.get(projectPath);
    if (instance) {
      killInstance(instance);
      return true;
    }
    return false;
  },

  keepalive(projectPath: string): boolean {
    const instance = instances.get(projectPath);
    if (instance) {
      // Check liveness first? No, simple update is fine, checkTimeout handles liveness.
      instance.lastKeepalive = Date.now();
      // Only log every 10th keepalive to avoid spam, or log if it was close to timeout?
      // console.log(`[WatchdogManager] Keepalive received for ${projectPath}`);
      saveSessions(); // Persist keepalive update? Optional but safe.
      return true;
    }
    console.warn(`[WatchdogManager] Keepalive failed: No instance found for ${projectPath}`);
    return false;
  },

    getStatus(projectPath: string): { running: boolean, port?: number } {

      const instance = instances.get(projectPath);

      if (instance) {

          // Verify liveness on status check

          try {

              if (instance.process) {

                  if (instance.process.exitCode !== null) {

                      killInstance(instance);

                      return { running: false };

                  }

              } else {

                  process.kill(instance.pid, 0);

              }

              return { running: true, port: instance.port };

          } catch(e) {

              killInstance(instance);

          }

      }

      return { running: false };

    },

  

    async relaunch(projectPath: string): Promise<{ port: number, pid: number }> {

      console.log(`[WatchdogManager] Relaunching for ${projectPath}`);

      this.stop(projectPath);

      // Wait a bit for the old process to potentially free up ports/resources

      await new Promise(resolve => setTimeout(resolve, 500));

      return this.start(projectPath);

    },

    list(): Array<{ projectPath: string, pid: number, port: number, lastKeepalive: number }> {
      return Array.from(instances.values()).map(i => ({
        projectPath: i.projectPath,
        pid: i.pid,
        port: i.port,
        lastKeepalive: i.lastKeepalive
      }));
    }

  };

  