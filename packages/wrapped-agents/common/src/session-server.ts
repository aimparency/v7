import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import cors from 'cors';
import { Agent } from './agent';
import { WatchdogService } from './watchdog-service';
import type { AutonomyPolicy } from './supervisor-state';
import type { AgentProfile, AgentType } from './agent-profile';

/**
 * Shared session entrypoint for every wrapped agent.
 *
 * All four sessions (claude/codex/gemini/agy) used to ship a ~350-line copy of
 * this server + spawn wiring. It now lives here once and is parameterized by an
 * AgentProfile. Each session package is reduced to a profile + a one-line call
 * to startSession().
 *
 * `packageDir` must be the calling package's compiled __dirname so the
 * package-relative kennel/client/INSTRUCT paths resolve exactly as before.
 */
export interface StartSessionOptions {
  packageDir: string;
  defaultCompactEvery?: number;
  portBase?: number;
}

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
  preferredAgentType: AgentType | null;
  agents: Partial<Record<AgentType, RuntimeAgentState>>;
};

export function startSession(profile: AgentProfile, options: StartSessionOptions): void {
  const { packageDir } = options;
  const PORT_BASE = options.portBase ?? 4011;
  // Restrict binding to a single interface (e.g. Tailscale IP) when set; otherwise all interfaces.
  const BIND_HOST = process.env.BIND_HOST || undefined;
  const AGENT_TYPE = profile.agentType;

  // Load instruction text for autonomous guidance (package-relative, as before).
  const INSTRUCT_PATH = path.join(packageDir, '../../INSTRUCT.md');
  let instructText = '';
  try {
    instructText = fs.readFileSync(INSTRUCT_PATH, 'utf-8');
  } catch (e) {
    console.warn('[WatchdogService] Could not load INSTRUCT.md:', e);
  }

  const app = express();
  app.use(cors());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
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

  app.use(express.static(path.join(packageDir, '../client/dist')));

  // Centralized error handling
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });

  // A stray rejection (e.g. a transient pty/socket error in the watchdog loop,
  // which only does real work once enabled) must NOT kill the session: that tears
  // down the user's live agent and surfaces as "transport close / Session lost" in
  // the UI. Log loudly and keep the supervisor running instead.
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[WARN] Unhandled Rejection (kept alive) at:', promise, 'reason:', reason);
    if (reason instanceof Error && reason.stack) {
      console.error(reason.stack);
    }
  });

  const args = process.argv.slice(2);

  let projectRootPath = path.resolve(packageDir, '../../../../');
  let workerModel: string | undefined = profile.defaultWorkerModel;
  let watchdogModel: string | undefined = profile.defaultWatchdogModel;
  let compactEvery = options.defaultCompactEvery ?? 20;
  let requestedPort = 0;

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
  const KENNEL_PATH = path.join(packageDir, '../kennel');
  const PROJECT_AIMPARENCY_DIR = path.join(PROJECT_ROOT, '.bowman');
  const WATCHDOG_RUNTIME_STATE_PATH = path.join(PROJECT_AIMPARENCY_DIR, 'runtime', 'watchdog-state.json');

  function readWatchdogRuntimeState(): WatchdogRuntimeState {
    try {
      if (!fs.existsSync(WATCHDOG_RUNTIME_STATE_PATH)) {
        return { updatedAt: 0, preferredAgentType: null, agents: {} };
      }
      return JSON.parse(fs.readFileSync(WATCHDOG_RUNTIME_STATE_PATH, 'utf8')) as WatchdogRuntimeState;
    } catch (error) {
      console.warn('[Watchdog] Failed to read runtime state:', error);
      return { updatedAt: 0, preferredAgentType: null, agents: {} };
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
            supervisorState: service.getSupervisorStateInfo(),
          },
        },
      };

      fs.mkdirSync(path.dirname(WATCHDOG_RUNTIME_STATE_PATH), { recursive: true });
      fs.writeFileSync(WATCHDOG_RUNTIME_STATE_PATH, JSON.stringify(next, null, 2));
    } catch (error) {
      console.warn('[Watchdog] Failed to persist runtime state:', error);
    }
  }

  console.log(`Starting ${profile.bannerName} Agents...`);
  console.log(`Worker Project Root: ${PROJECT_ROOT}`);
  console.log(`Worker Model: ${workerModel ?? 'default'}`);
  console.log(`Watchdog Model: ${watchdogModel ?? 'default'}`);
  console.log(`Compact Watchdog Context Every: ${compactEvery} turns`);

  let worker: Agent;
  let watchdogService: WatchdogService | undefined;

  function startWorker(resume: boolean) {
    if (worker) {
      try {
        worker.kill();
      } catch (e) {}
    }

    const currentArgs = profile.buildWorkerArgs({ resume, workerModel });
    console.log(`Starting ${profile.bannerName} worker (Resume: ${resume})...`);

    let relaunched = false;
    const relaunchFresh = () => {
      if (relaunched) return;
      relaunched = true;
      console.warn('[Worker] Resume failed. Restarting fresh...');
      startWorker(false);
      if (watchdogService) watchdogService.worker = worker;
    };

    worker = new Agent(
      profile.command,
      PROJECT_ROOT,
      currentArgs,
      (data) => {
        if (resume && profile.resumeFailurePatterns.some((p) => p.test(data))) {
          relaunchFresh();
          return;
        }
        io.emit('worker-data', data);
        if (watchdogService) watchdogService.onWorkerData(data);
      },
      profile.cols
    );

    if (profile.relaunchOnNonZeroExit) {
      worker.ptyProcess.onExit(({ exitCode }) => {
        if (resume && exitCode !== 0) {
          relaunchFresh();
        }
      });
    }
  }

  startWorker(true);

  const watchdog = new Agent(
    profile.command,
    KENNEL_PATH,
    profile.buildWatchdogArgs({ watchdogModel }),
    (data) => {
      io.emit('watchdog-data', data);
    },
    profile.cols
  );

  const autonomyPolicy = readAutonomyPolicy();
  watchdogService = new WatchdogService(worker!, watchdog, profile, {
    expectedModel: workerModel,
    compactEvery,
    projectPath: PROJECT_ROOT,
    autonomyPolicy,
    instructText,
  });

  const existingRuntimeState = readWatchdogRuntimeState().agents[AGENT_TYPE];
  if (existingRuntimeState) {
    watchdogService.lastStopReason = existingRuntimeState.stopReason ?? '';
    watchdogService.emergencyStopped = existingRuntimeState.emergencyStopped;
    if (existingRuntimeState.enabled && autonomyPolicy.restoreSupervisorStateOnSessionRestart !== false) {
      watchdogService.setEnabled(true);
    }
  }
  watchdogService.onStateChange = () => {
    persistWatchdogRuntimeState(watchdogService!);
    io.emit('supervisor-state', watchdogService!.getSupervisorStateInfo());
  };
  watchdogService.onCommStatusChange = (status) => {
    io.emit('watchdog-comm-status', status);
  };
  persistWatchdogRuntimeState(watchdogService);

  watchdogService.onStop = (reason) => {
    console.log(`Watchdog stopped: ${reason}`);
    io.emit('watchdog-state', false);
    io.emit('watchdog-stop-reason', watchdogService!.lastStopReason || reason);
    io.emit('supervisor-state', watchdogService!.getSupervisorStateInfo());
  };

  watchdogService.onEmergencyStop = () => {
    io.emit('emergency-stop');
    io.emit('supervisor-state', watchdogService!.getSupervisorStateInfo());
  };

  io.on('connection', (socket) => {
    console.log('WebUI Client connected');
    socket.emit('watchdog-state', watchdogService!.enabled);
    socket.emit('emergency-state', watchdogService!.emergencyStopped);
    if (!watchdogService!.enabled) {
      socket.emit('watchdog-stop-reason', watchdogService!.lastStopReason);
    }
    socket.emit('supervisor-state', watchdogService!.getSupervisorStateInfo());
    socket.emit('watchdog-comm-status', watchdogService!.getCommStatus());

    // Replay is deferred until the client announces its real terminal size (via
    // the resize handlers below). Sending a snapshot now — before we know the
    // browser pane's dimensions — would force the client to write at xterm's
    // 80x24 default and then reflow, garbling the screen. We replay the faithful
    // serialized snapshot (color + cursor preserved) once, right after resizing
    // the agent to match the client.
    const snapshotted = new Set<'worker' | 'watchdog'>();

    socket.on('toggle-watchdog', (enabled: boolean) => {
      watchdogService!.setEnabled(enabled);
      io.emit('watchdog-state', enabled);
      io.emit('emergency-state', watchdogService!.emergencyStopped);
      // Only report a stop reason when actually stopping; emitting it on enable
      // makes the UI log a spurious "Watchdog stopped" right after "ENABLED".
      if (!enabled) io.emit('watchdog-stop-reason', watchdogService!.lastStopReason);
      io.emit('supervisor-state', watchdogService!.getSupervisorStateInfo());
    });

    socket.on('worker-input', (data) => worker.write(data));
    socket.on('watchdog-input', (data) => watchdog.write(data));

    // Nudge the agent's TUI into a clean full repaint before the one-shot replay.
    // Resizing already sends SIGWINCH, and Ink/Claude CLI repaints the whole
    // frame on resize — which clears stale footer/cursor artifacts left over
    // from the CLI's own incremental redraws. We perturb rows by one and restore
    // to force that repaint even when the client's size matches the pty's current
    // size, then defer the serialize so the redraw has actually flushed into the
    // headless buffer; snapshotting synchronously grabs the pre-redraw frame.
    //
    // The snapshot is emitted on a dedicated `${kind}-snapshot` channel, NOT on
    // the live `${kind}-data` channel. The perturbation's SIGWINCH makes the CLI
    // repaint, and that repaint streams live to this freshly connected socket
    // during the 150ms window — incremental redraw escapes that garble when
    // written into the client's still-empty buffer. The client resets its
    // terminal when the snapshot arrives, wiping that pre-snapshot live garble
    // before writing the faithful frame; subsequent live data then appends cleanly.
    const replayWithRepaint = (
      agent: Agent,
      kind: 'worker' | 'watchdog',
      cols: number,
      rows: number,
    ) => {
      agent.resize(cols, rows);
      if (snapshotted.has(kind)) return;
      snapshotted.add(kind);
      agent.resize(cols, Math.max(1, rows - 1));
      agent.resize(cols, rows);
      setTimeout(() => socket.emit(`${kind}-snapshot`, agent.serialize()), 150);
    };

    socket.on('resize-worker', ({ cols, rows }) => replayWithRepaint(worker, 'worker', cols, rows));
    socket.on('resize-watchdog', ({ cols, rows }) => replayWithRepaint(watchdog, 'watchdog', cols, rows));
  });

  setInterval(() => {
    watchdogService!.tick();
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
    const PORT = requestedPort > 0 ? requestedPort : await findAvailablePort(PORT_BASE);
    httpServer.listen(PORT, BIND_HOST, async () => {
      console.log(`${profile.bannerName} Watchdog Server running at http://${BIND_HOST || 'localhost'}:${PORT}`);

      // Only open browser if port was NOT manually specified (implies manual run vs managed run)
      if (requestedPort === 0) {
        console.log('Opening WebUI in browser...');
        try {
          const openModule = await import('open');
          openModule.default(`http://localhost:${PORT}`);
        } catch (e) {
          console.log('Could not auto-open browser. Please open manually.');
        }
      }
    });
  })();
}
