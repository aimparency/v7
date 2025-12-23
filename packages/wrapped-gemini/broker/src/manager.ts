import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

import { AIMPARENCY_DIR_NAME } from 'shared';

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
const KEEPALIVE_TIMEOUT = 60 * 60 * 1000; // 60 minutes

// Location: packages/wrapped-gemini/broker/src/manager.ts
// WRAPPER_DIR: packages/wrapped-gemini (2 levels up from src)
const WRAPPER_DIR = path.resolve(__dirname, '../../');
const SESSIONS_FILE = path.join(WRAPPER_DIR, 'watchdog-sessions.json');

function normalizeProjectPath(p: string): string {
  if (!p) return p;
  // Handle potential trailing slash
  const clean = p.replace(/[\\/]$/, '');
  if (clean.endsWith(AIMPARENCY_DIR_NAME)) return clean;
  return path.join(clean, AIMPARENCY_DIR_NAME);
}

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
    console.error('[WatchdogBroker] Failed to save sessions:', e);
  }
}

function killInstance(instance: WatchdogInstance) {
  console.log(`[WatchdogBroker] Killing instance for ${instance.projectPath} (PID ${instance.pid})`);
  try {
    // Kill the entire process group because we spawned with 'detached: true'
    process.kill(-instance.pid, 'SIGTERM');
  } catch(e) {
    // Fallback to single process kill if group kill fails
    try {
      if (instance.process) {
        instance.process.kill();
      } else {
        process.kill(instance.pid);
      }
    } catch(e2) {
      // Ignore if already dead
    }
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
      console.log(`[WatchdogBroker] Timeout for ${projectPath}. Elapsed: ${elapsed}ms > Limit: ${KEEPALIVE_TIMEOUT}ms. Killing process.`);
      killInstance(instance);
    }
  }
}

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readJsonSync(SESSIONS_FILE);
      console.log(`[WatchdogBroker] Loading ${data.length} sessions from file.`);
      
      data.forEach((s: any) => {
        // Check if alive
        try {
          process.kill(s.pid, 0);
          
          // Check if timed out while we were away
          if (Date.now() - s.lastKeepalive > KEEPALIVE_TIMEOUT) {
             console.log(`[WatchdogBroker] Reclaimed session for ${s.projectPath} (PID ${s.pid}) is expired. Killing.`);
             try { process.kill(s.pid); } catch(e){}
             return;
          }

          console.log(`[WatchdogBroker] Reclaiming session for ${s.projectPath} (PID ${s.pid})`);
          
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
          console.log(`[WatchdogBroker] Session for ${s.projectPath} (PID ${s.pid}) is dead.`);
        }
      });
    }
  } catch (e) {
    console.error('[WatchdogBroker] Failed to load sessions:', e);
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
    projectPath = normalizeProjectPath(projectPath);

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
            console.log(`[WatchdogBroker] Existing instance dead, cleaning up.`);
            killInstance(existing);
        }
    }

    // Find free port starting from process start port
    const startPort = parseInt(process.env.PORT_PROCESS_START || '7000');
    const port = await findAvailablePort(startPort);

    // Path to Worker entry point:
    const workerScript = path.join(WRAPPER_DIR, 'process/dist/index.js');

    console.log(`[WatchdogBroker] Spawning worker on port ${port} for ${projectPath}`);
    console.log(`[WatchdogBroker] Script: ${workerScript}`);

    // Ensure we pass the PROJECT ROOT to the watchdog, not the .bowman dir
    const projectRoot = path.dirname(projectPath);

    // Prepare logs
    const logDir = path.join(WRAPPER_DIR, 'logs', String(port));
    fs.ensureDirSync(logDir);
    const out = fs.openSync(path.join(logDir, 'out.log'), 'a');
    const err = fs.openSync(path.join(logDir, 'err.log'), 'a');

    const child = spawn('node', [workerScript, '--port', String(port), projectRoot], {
      // cwd: ROOT_DIR, // Keep running from root if needed for deps, or WRAPPER_DIR? 
      // User diff removed ROOT_DIR usage for workerScript but didn't change CWD explicitly in diff view.
      // But ROOT_DIR definition was removed.
      // Let's use WRAPPER_DIR or process.cwd()?
      // The child process needs to find node_modules.
      // If we run from WRAPPER_DIR, we are in packages/wrapped-gemini.
      // It has its own package.json? No, it's a workspace.
      // Let's use WRAPPER_DIR for CWD.
      cwd: WRAPPER_DIR,
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env }
    });
    
    child.unref();

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

    // Wait for port to be ready
    console.log(`[WatchdogBroker] Waiting for port ${port} to be open...`);
    let ready = false;
    for (let i = 0; i < 20; i++) { // 10 seconds timeout
        try {
            await new Promise((resolve, reject) => {
                const s = net.createConnection(port, 'localhost');
                s.on('connect', () => { s.end(); resolve(true); });
                s.on('error', () => { reject(); });
            });
            ready = true;
            break;
        } catch(e) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    if (!ready) {
        console.warn(`[WatchdogBroker] Port ${port} did not open within timeout.`);
    } else {
        console.log(`[WatchdogBroker] Port ${port} is ready.`);
    }

    child.on('exit', (code) => {
      console.log(`[WatchdogBroker] Worker for ${projectPath} exited with code ${code}`);
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
    projectPath = normalizeProjectPath(projectPath);
    const instance = instances.get(projectPath);
    if (instance) {
      killInstance(instance);
      return true;
    }
    return false;
  },

  async keepalive(projectPath: string): Promise<boolean> {
    projectPath = normalizeProjectPath(projectPath);
    const instance = instances.get(projectPath);
    if (instance) {
      instance.lastKeepalive = Date.now();
      saveSessions();
      return true;
    }
    console.warn(`[WatchdogBroker] Keepalive warning: No instance found for ${projectPath}. Relaunching...`);
    try {
        await this.start(projectPath);
        return true;
    } catch (e) {
        console.error(`[WatchdogBroker] Failed to relaunch during keepalive:`, e);
        return false;
    }
  },

  getStatus(projectPath: string): { running: boolean, port?: number } {
      projectPath = normalizeProjectPath(projectPath);
      const instance = instances.get(projectPath);
      if (instance) {
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
      projectPath = normalizeProjectPath(projectPath);
      console.log(`[WatchdogBroker] Relaunching for ${projectPath}`);
      this.stop(projectPath);
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
