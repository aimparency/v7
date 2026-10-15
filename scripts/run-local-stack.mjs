import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import concurrently from 'concurrently';

// One launcher for the local stack. Dev runs every server from TypeScript source
// through tsx (no watchers, no build step); start builds bundles and runs those.
//
//   node scripts/run-local-stack.mjs dev|start [<repo path or git url>] [--full] [--host] [--delay] [--no-build] [--dry-run]
//
//   <repo ...>  print a link that opens that project (a git URL opens read-only)
//   --full      also the broker client, MCP over SSE and the voice bridge
//   --host      bind to LAN_BIND_HOST (or the tailscale IP) and serve MCP over SSE
//   --delay     DEV_DELAY=true: the backend slows responses (frontend e2e tests)
//   --no-build  start: run the existing bundles without rebuilding

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const frontendPublicDir = path.join(repoRoot, 'packages', 'frontend', 'public');
const runtimeConfigPath = path.join(frontendPublicDir, 'runtime-config.json');

const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) {
  // Never overrides variables that are already set, so explicit PORT_* still win.
  process.loadEnvFile(envFile);
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));

const preferredPorts = {
  frontendPort: parsePort(process.env.PORT_FRONTEND, 4000),
  backendHttpPort: parsePort(process.env.PORT_BACKEND_HTTP, 3000),
  backendWsPort: parsePort(process.env.PORT_BACKEND_WS, 3001),
  brokerHttpPort: parsePort(process.env.PORT_BROKER_HTTP, 5000),
  brokerWsPort: parsePort(process.env.PORT_BROKER_WS, 5001),
  processStartPort: parsePort(process.env.PORT_PROCESS_START, 7000),
};

function parseBoolean(value, fallback = false) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return fallback;
}

function parsePort(value, fallback) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function canListen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      server.close();
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }

      reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, reservedPorts) {
  let port = startPort;

  while (reservedPorts.has(port) || !await canListen(port)) {
    port += 1;
  }

  reservedPorts.add(port);
  return port;
}

async function resolvePorts() {
  const reservedPorts = new Set();

  return {
    frontendPort: await findAvailablePort(preferredPorts.frontendPort, reservedPorts),
    backendHttpPort: await findAvailablePort(preferredPorts.backendHttpPort, reservedPorts),
    backendWsPort: await findAvailablePort(preferredPorts.backendWsPort, reservedPorts),
    brokerHttpPort: await findAvailablePort(preferredPorts.brokerHttpPort, reservedPorts),
    brokerWsPort: await findAvailablePort(preferredPorts.brokerWsPort, reservedPorts),
    processStartPort: await findAvailablePort(preferredPorts.processStartPort, reservedPorts),
  };
}

function runtimeConfig(resolvedPorts) {
  return {
    ...resolvedPorts,
    voiceEnabled: parseBoolean(process.env.AIMPARENCY_ENABLE_VOICE, false),
    generatedAt: new Date().toISOString(),
  };
}

async function writeRuntimeConfig(resolvedPorts) {
  await fs.mkdir(frontendPublicDir, { recursive: true });
  await fs.writeFile(runtimeConfigPath, JSON.stringify(runtimeConfig(resolvedPorts), null, 2) + '\n');
}

function logPortSummary(resolvedPorts) {
  console.log('[local-runtime] Resolved local ports:');
  console.log(`[local-runtime] frontend: http://localhost:${resolvedPorts.frontendPort}`);
  console.log(`[local-runtime] backend: http://localhost:${resolvedPorts.backendHttpPort} / ws://localhost:${resolvedPorts.backendWsPort}`);
  console.log(`[local-runtime] broker: http://localhost:${resolvedPorts.brokerHttpPort} / ws://localhost:${resolvedPorts.brokerWsPort}`);
  console.log(`[local-runtime] sessions: starting from ${resolvedPorts.processStartPort}`);
  console.log(`[local-runtime] frontend runtime config: ${path.relative(repoRoot, runtimeConfigPath)}`);
}

function createEnv(resolvedPorts) {
  return {
    ...process.env,
    PORT_FRONTEND: String(resolvedPorts.frontendPort),
    PORT_BACKEND_HTTP: String(resolvedPorts.backendHttpPort),
    PORT_BACKEND_WS: String(resolvedPorts.backendWsPort),
    PORT_BROKER_HTTP: String(resolvedPorts.brokerHttpPort),
    PORT_BROKER_WS: String(resolvedPorts.brokerWsPort),
    PORT_PROCESS_START: String(resolvedPorts.processStartPort),
  };
}

function runCommand(command, commandArgs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited via signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
        return;
      }

      resolve();
    });

    child.on('error', reject);
  });
}

function resolveBindHost() {
  if (process.env.LAN_BIND_HOST) {
    return process.env.LAN_BIND_HOST;
  }
  try {
    return execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).split('\n')[0].trim() || undefined;
  } catch {
    return undefined;
  }
}

// Each command runs directly in its package (no pnpm/dotenv wrapper processes),
// with that package's binaries (pnpm does not hoist them to the root) first on PATH.
function stackCommands(mode, env) {
  const dev = mode === 'dev';
  const full = flags.has('--full');
  const command = (name, prefixColor, dir, devCommand, startCommand) => {
    const cwd = path.join(repoRoot, 'packages', dir);
    return {
      name,
      prefixColor,
      cwd,
      command: dev ? devCommand : startCommand,
      env: { ...env, PATH: [path.join(cwd, 'node_modules', '.bin'), env.PATH].join(path.delimiter) },
    };
  };

  const commands = [
    command('BACK', 'blue', 'backend', 'tsx watch src/server.ts', 'node dist/server.js'),
    command('BROK', 'yellow', 'wrapped-agents/broker', 'tsx watch src/index.ts', 'node dist/index.js'),
    command('FRNT', 'green', 'frontend', 'vite', 'vite preview'),
  ];
  if (full || flags.has('--host')) {
    commands.push(command('MCPS', 'magenta', 'mcp', 'tsx watch src/sse.ts', 'node build/sse.js'));
  }
  if (full) {
    // In start mode the broker serves the built client itself.
    if (dev) {
      commands.push(command('CLNT', 'white', 'wrapped-agents/client', `vite --port ${env.PORT_BROKER_CLIENT || 5005}`));
    }
    commands.push(command('VOICE', 'gray', 'voice-bridge', 'tsx watch src/index.ts', 'node dist/index.js'));
  }
  return commands;
}

function preflight(mode) {
  if (mode === 'dev') {
    return [['tsx', ['packages/mobile/scripts/generate-config.ts']]];
  }
  if (flags.has('--no-build')) {
    return [];
  }
  return [[pnpmCommand, ['run', flags.has('--full') ? 'build:optional' : 'build:core']]];
}

// `pnpm dev ../my-repo` runs from the repo root; pnpm keeps the caller's directory in INIT_CWD.
function projectLink(target, frontendPort) {
  const url = new URL(`http://localhost:${frontendPort}/`);
  if (/^(https?:\/\/|ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(target)) {
    url.searchParams.set('repo', target);
    return url.href;
  }
  const projectPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), target);
  if (!existsSync(projectPath)) {
    console.error(`[local-runtime] No such directory: ${projectPath}`);
    process.exit(1);
  }
  url.searchParams.set('project', projectPath);
  return url.href;
}

async function main() {
  const [mode = 'start', target] = args.filter((arg) => !arg.startsWith('--'));
  if (mode !== 'dev' && mode !== 'start') {
    console.error(`Unknown mode "${mode}". Expected dev or start.`);
    process.exit(1);
  }

  const resolvedPorts = await resolvePorts();
  // A dry run prints the config instead: writing it would repoint a running stack's frontend.
  if (flags.has('--dry-run')) {
    console.log(`[local-runtime] runtime config (dry run): ${JSON.stringify(runtimeConfig(resolvedPorts))}`);
  } else {
    await writeRuntimeConfig(resolvedPorts);
  }
  logPortSummary(resolvedPorts);
  if (target) {
    console.log(`[local-runtime] open: ${projectLink(target, resolvedPorts.frontendPort)}`);
  }

  const env = createEnv(resolvedPorts);
  // Root binaries (tsx for the preflight); stack commands add their package's own.
  env.PATH = [path.join(repoRoot, 'node_modules', '.bin'), env.PATH].join(path.delimiter);
  if (flags.has('--delay')) {
    env.DEV_DELAY = 'true';
  }
  if (flags.has('--host')) {
    env.BIND_HOST = resolveBindHost();
    if (!env.BIND_HOST) {
      console.error('[local-runtime] No BIND_HOST: set LAN_BIND_HOST in .env or start Tailscale');
      process.exit(1);
    }
    console.log(`[local-runtime] hosting on http://${env.BIND_HOST}:${resolvedPorts.frontendPort}`);
  }

  const commands = stackCommands(mode, env);
  if (flags.has('--dry-run')) {
    for (const { name, cwd, command } of commands) {
      console.log(`[local-runtime] ${name}: (${path.relative(repoRoot, cwd)}) ${command}`);
    }
    return;
  }

  for (const [command, commandArgs] of preflight(mode)) {
    await runCommand(command, commandArgs, env);
  }

  await concurrently(commands, { prefix: 'name' }).result;
}

main().catch((error) => {
  console.error('[local-runtime] Failed to start local stack.');
  console.error(error);
  process.exit(1);
});
