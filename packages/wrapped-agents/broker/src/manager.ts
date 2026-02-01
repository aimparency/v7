import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

import { AIMPARENCY_DIR_NAME } from 'shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AgentType = 'claude' | 'gemini';

interface WatchdogInstance {
  process?: ChildProcess;
  pid: number;
  port: number;
  projectPath: string;
  agentType: AgentType;
  lastKeepalive: number;
  checkInterval: NodeJS.Timeout;
}

const instances = new Map<string, WatchdogInstance>();
const KEEPALIVE_TIMEOUT = 60 * 60 * 1000; // 60 minutes

// Compound key for instances: allows same project with different agent types
function getInstanceKey(projectPath: string, agentType: AgentType): string {
  return `${projectPath}:${agentType}`;
}

// Location: packages/wrapped-agents/broker/src/manager.ts
// WRAPPER_DIR: packages/wrapped-agents (2 levels up from src)
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
    agentType: i.agentType,
    lastKeepalive: i.lastKeepalive
  }));
  try {
    fs.writeJsonSync(SESSIONS_FILE, data);
  } catch (e) {
    console.error('[WatchdogBroker] Failed to save sessions:', e);
  }
}

function killInstance(instance: WatchdogInstance) {
  console.log(`[WatchdogBroker] Killing ${instance.agentType} instance for ${instance.projectPath} (PID ${instance.pid})`);
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
  instances.delete(getInstanceKey(instance.projectPath, instance.agentType));
  saveSessions();
}

function checkTimeout(projectPath: string, agentType: AgentType) {
  const key = getInstanceKey(projectPath, agentType);
  const instance = instances.get(key);
  if (instance) {
    const elapsed = Date.now() - instance.lastKeepalive;
    if (elapsed > KEEPALIVE_TIMEOUT) {
      console.log(`[WatchdogBroker] Timeout for ${agentType}@${projectPath}. Elapsed: ${elapsed}ms > Limit: ${KEEPALIVE_TIMEOUT}ms. Killing process.`);
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
        // Default to gemini for backward compatibility
        const agentType: AgentType = s.agentType || 'gemini';
        const key = getInstanceKey(s.projectPath, agentType);

        // Check if alive
        try {
          process.kill(s.pid, 0);

          // Check if timed out while we were away
          if (Date.now() - s.lastKeepalive > KEEPALIVE_TIMEOUT) {
             console.log(`[WatchdogBroker] Reclaimed ${agentType} session for ${s.projectPath} (PID ${s.pid}) is expired. Killing.`);
             // Kill process group to clean up any children
             try { process.kill(-s.pid, 'SIGTERM'); } catch(e) {
               try { process.kill(s.pid); } catch(e2) {}
             }
             return;
          }

          console.log(`[WatchdogBroker] Reclaiming ${agentType} session for ${s.projectPath} (PID ${s.pid})`);

          const checkInterval = setInterval(() => {
            checkTimeout(s.projectPath, agentType);
          }, 30 * 1000);

          instances.set(key, {
            pid: s.pid,
            port: s.port,
            projectPath: s.projectPath,
            agentType,
            lastKeepalive: s.lastKeepalive,
            checkInterval
          });
        } catch (e) {
          console.log(`[WatchdogBroker] ${agentType} session for ${s.projectPath} (PID ${s.pid}) is dead.`);
        }
      });

      // Persist cleaned state - removes dead/expired sessions from file
      saveSessions();
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
  async start(projectPath: string, agentType: AgentType = 'gemini'): Promise<{ port: number, pid: number, agentType: AgentType }> {
    projectPath = normalizeProjectPath(projectPath);
    const key = getInstanceKey(projectPath, agentType);

    // Check if already running
    const existing = instances.get(key);
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
            return { port: existing.port, pid: existing.pid, agentType };
        } catch (e) {
            console.log(`[WatchdogBroker] Existing ${agentType} instance dead, cleaning up.`);
            killInstance(existing);
        }
    }

    // Find free port starting from process start port
    const startPort = parseInt(process.env.PORT_PROCESS_START || '7000');
    const port = await findAvailablePort(startPort);

    // Path to Worker entry point - dynamic based on agent type
    const workerScript = path.join(WRAPPER_DIR, `${agentType}-session/dist/index.js`);

    console.log(`[WatchdogBroker] Spawning ${agentType} worker on port ${port} for ${projectPath}`);
    console.log(`[WatchdogBroker] Script: ${workerScript}`);

    // Ensure we pass the PROJECT ROOT to the watchdog, not the .bowman dir
    const projectRoot = path.dirname(projectPath);

    // Prepare logs
    const logDir = path.join(WRAPPER_DIR, 'logs', String(port));
    fs.ensureDirSync(logDir);
    const out = fs.openSync(path.join(logDir, 'out.log'), 'a');
    const err = fs.openSync(path.join(logDir, 'err.log'), 'a');

    const child = spawn('node', [workerScript, '--port', String(port), projectRoot], {
      cwd: WRAPPER_DIR,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], // Use pipes to capture output
      env: { ...process.env }
    });

    // Capture and log output so it gets the [BROK] prefix from concurrently
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const str = data.toString().trim();
        if (str) console.log(str);
        fs.appendFileSync(path.join(logDir, 'out.log'), data);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const str = data.toString().trim();
        if (str) console.error(str);
        fs.appendFileSync(path.join(logDir, 'err.log'), data);
      });
    }

    child.unref();

    const checkInterval = setInterval(() => {
        checkTimeout(projectPath, agentType);
    }, 30 * 1000); // Check every 30 seconds

    instances.set(key, {
      process: child,
      pid: child.pid!,
      port,
      projectPath,
      agentType,
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
      console.log(`[WatchdogBroker] ${agentType} worker for ${projectPath} exited with code ${code}`);
      const instance = instances.get(key);
      if (instance?.process === child) {
        clearInterval(instance.checkInterval);
        instances.delete(key);
        saveSessions();
      }
    });

    return { port, pid: child.pid!, agentType };
  },

  stop(projectPath: string, agentType: AgentType = 'gemini'): boolean {
    projectPath = normalizeProjectPath(projectPath);
    const key = getInstanceKey(projectPath, agentType);
    const instance = instances.get(key);
    if (instance) {
      killInstance(instance);
      return true;
    }
    return false;
  },

  async keepalive(projectPath: string, agentType: AgentType = 'gemini'): Promise<boolean> {
    projectPath = normalizeProjectPath(projectPath);
    const key = getInstanceKey(projectPath, agentType);
    const instance = instances.get(key);
    if (instance) {
      instance.lastKeepalive = Date.now();
      saveSessions();
      return true;
    }
    // Don't auto-spawn - let the client handle reconnection explicitly
    console.warn(`[WatchdogBroker] Keepalive: No ${agentType} instance found for ${projectPath}.`);
    return false;
  },

  getStatus(projectPath: string, agentType: AgentType = 'gemini'): { running: boolean, port?: number, agentType?: AgentType } {
      projectPath = normalizeProjectPath(projectPath);
      const key = getInstanceKey(projectPath, agentType);
      const instance = instances.get(key);
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
              return { running: true, port: instance.port, agentType: instance.agentType };
          } catch(e) {
              killInstance(instance);
          }
      }
      return { running: false };
  },

  async relaunch(projectPath: string, agentType: AgentType = 'gemini'): Promise<{ port: number, pid: number, agentType: AgentType }> {
      projectPath = normalizeProjectPath(projectPath);
      console.log(`[WatchdogBroker] Relaunching ${agentType} for ${projectPath}`);
      this.stop(projectPath, agentType);
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.start(projectPath, agentType);
  },

  list(): Array<{ projectPath: string, pid: number, port: number, agentType: AgentType, lastKeepalive: number }> {
      return Array.from(instances.values()).map(i => ({
        projectPath: i.projectPath,
        pid: i.pid,
        port: i.port,
        agentType: i.agentType,
        lastKeepalive: i.lastKeepalive
      }));
  }
};
