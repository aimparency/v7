import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import concurrently from 'concurrently';
import { ask, askNewPassword, askYesNo, closeQuestions } from './ask.mjs';

// One launcher for the local stack. Dev runs every server from TypeScript source
// through tsx (no watchers, no build step); start builds bundles and runs those.
//
//   node scripts/run-local-stack.mjs dev|start [<repo path or git url>] [--full] [--host] [--delay] [--no-build] [--port <n>] [--setup] [--dry-run]
//
//   <repo ...>  print a link that opens that project (a git URL opens read-only)
//   --full      also the broker client, MCP over SSE and the voice bridge
//   --host      dev: bind to LAN_BIND_HOST (or the tailscale IP) and serve MCP over SSE
//   --delay     DEV_DELAY=true: the backend slows responses (frontend e2e tests)
//   --no-build  start: run the existing bundles without rebuilding
//   --port <n>  start: the frontend port, or the one port of a hosted instance
//   --setup     start: ask the setup questions again
//
// dev picks free ports next to the configured ones (parallel worktrees); start
// uses exactly the configured ports, so a proxy in front of it can rely on them.
//
// The first `start` in a terminal asks which repository to serve and whether
// other people may reach it; the answers go to .env. Hosted
// (AIMPARENCY_HOSTED=true), one port carries the built UI, the API and the MCP
// server for that one project; reading is open, writing needs an account
// (pnpm accounts), and agents and loops stay off.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const frontendPublicDir = path.join(repoRoot, 'packages', 'frontend', 'public');
const runtimeConfigPath = path.join(frontendPublicDir, 'runtime-config.json');

// AIMPARENCY_ENV_FILE: another .env (tests of the setup).
const envFile = process.env.AIMPARENCY_ENV_FILE ?? path.join(repoRoot, '.env');
if (existsSync(envFile)) {
  // Never overrides variables that are already set, so explicit PORT_* still win.
  process.loadEnvFile(envFile);
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const portFlag = args.indexOf('--port');
const portOverride = portFlag >= 0 ? parsePort(args[portFlag + 1], undefined) : undefined;
if (portFlag >= 0 && !portOverride) {
  console.error('[local-runtime] --port needs a port number');
  process.exit(1);
}
const positional = args.filter((arg, index) => !arg.startsWith('--') && !(portFlag >= 0 && index === portFlag + 1));

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

async function resolvePorts(mode) {
  const reservedPorts = new Set();
  const preferred = { ...preferredPorts, frontendPort: portOverride ?? preferredPorts.frontendPort };
  if (mode === 'start') {
    await requireFreePorts(preferred);
    return preferred;
  }

  return {
    frontendPort: await findAvailablePort(preferred.frontendPort, reservedPorts),
    backendHttpPort: await findAvailablePort(preferred.backendHttpPort, reservedPorts),
    backendWsPort: await findAvailablePort(preferred.backendWsPort, reservedPorts),
    brokerHttpPort: await findAvailablePort(preferred.brokerHttpPort, reservedPorts),
    brokerWsPort: await findAvailablePort(preferred.brokerWsPort, reservedPorts),
    processStartPort: await findAvailablePort(preferred.processStartPort, reservedPorts),
  };
}

// start: the configured ports or nothing, so a proxy never points at a stranger.
async function requireFreePorts(ports) {
  for (const [name, port] of Object.entries(ports)) {
    if (!await canListen(port)) {
      throw new UsageError(`Port ${port} (${name}) is in use. Stop what uses it, pass --port <n>, or set the PORT_* entries in .env.`);
    }
  }
}

class UsageError extends Error {}

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
  if (isGitUrl(target)) {
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

function isGitUrl(target) {
  return /^(https?:\/\/|ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(target);
}

// Sets keys in .env, keeping every other line as it is.
async function saveEnv(values) {
  let text = existsSync(envFile) ? await fs.readFile(envFile, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
    process.env[key] = String(value);
  }
  await fs.writeFile(envFile, text);
}

function hasAdmin(projectPath) {
  try {
    const accounts = JSON.parse(readFileSync(path.join(projectPath, '.bowman', 'runtime', 'accounts.json'), 'utf8'));
    return accounts.users?.some((user) => user.role === 'admin') ?? false;
  } catch {
    return false;
  }
}

// A git URL is cloned next to this checkout, the way someone would by hand.
async function askRepository() {
  for (;;) {
    const answer = await ask('Repository to serve (a path or a git URL; empty: choose in the browser):', process.env.AIMPARENCY_PROJECT ?? '');
    if (!answer) return '';
    if (isGitUrl(answer)) {
      const target = path.resolve(repoRoot, '..', path.basename(answer).replace(/\.git$/, ''));
      if (!existsSync(target)) {
        try {
          await runCommand('git', ['clone', answer, target], process.env);
        } catch {
          console.log('Cloning failed; try another URL or a path.');
          continue;
        }
      }
      return target;
    }
    const projectPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), answer.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (existsSync(projectPath)) return projectPath;
    console.log(`No such directory: ${projectPath}`);
  }
}

async function setup() {
  console.log('[local-runtime] Setup. The answers go to .env; `pnpm start --setup` asks again.');
  const project = await askRepository();
  const hosted = project !== '' && await askYesNo('Host it for other people? (reading open to anyone, writing with an account)', process.env.AIMPARENCY_HOSTED === 'true');
  const values = { AIMPARENCY_PROJECT: project, AIMPARENCY_HOSTED: hosted };
  if (hosted) {
    values.PORT = parsePort(await ask('Port:', process.env.PORT ?? '4000'), 4000);
    values.BIND_HOST = await ask('Listen on (127.0.0.1 behind nginx, 0.0.0.0 for everyone, or a Tailscale IP):', process.env.BIND_HOST || '127.0.0.1');
  }
  await saveEnv(values);
  if (hosted && !hasAdmin(project)) {
    console.log('[local-runtime] The first account, an admin, who manages the others in the UI:');
    const name = await ask('Admin name:', process.env.USER ?? 'admin');
    const password = await askNewPassword(name);
    await runCommand(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['scripts/accounts.mjs', 'add', name, 'admin', '--project', project], { ...process.env, AIMPARENCY_PASSWORD: password });
  }
  closeQuestions();
}

// Hosted: the backend serves the UI, the API and (proxied) the MCP server on one port.
function hostedCommands(env) {
  const command = (name, prefixColor, dir, startCommand, extraEnv) => {
    const cwd = path.join(repoRoot, 'packages', dir);
    return {
      name,
      prefixColor,
      cwd,
      command: startCommand,
      env: { ...env, ...extraEnv, PATH: [path.join(cwd, 'node_modules', '.bin'), env.PATH].join(path.delimiter) },
    };
  };
  const backendHost = env.BIND_HOST === '0.0.0.0' ? '127.0.0.1' : env.BIND_HOST;
  return [
    command('BACK', 'blue', 'backend', 'node dist/server.js', {}),
    command('MCPS', 'magenta', 'mcp', 'node build/sse.js', {
      MCP_BASE_PATH: '/mcp',
      MCP_BIND_HOST: '127.0.0.1',
      BACKEND_WS_URL: `ws://${backendHost}:${env.PORT}/trpc`,
    }),
  ];
}

async function startHosted() {
  const project = process.env.AIMPARENCY_PROJECT;
  if (!project || !existsSync(project)) {
    throw new UsageError(`AIMPARENCY_PROJECT (${project || 'unset'}) is no directory. Run \`pnpm start --setup\`.`);
  }
  if (!hasAdmin(project)) {
    throw new UsageError('No admin account yet. Run `pnpm start --setup` once in a terminal, or `pnpm accounts add <name> admin`.');
  }
  const port = portOverride ?? parsePort(process.env.PORT, 4000);
  const mcpPort = parsePort(process.env.PORT_MCP, 3005);
  const env = {
    ...process.env,
    PORT: String(port),
    PORT_MCP: String(mcpPort),
    BIND_HOST: process.env.BIND_HOST || '127.0.0.1',
    PATH: [path.join(repoRoot, 'node_modules', '.bin'), process.env.PATH].join(path.delimiter),
  };
  await requireFreePorts({ port, mcpPort });
  const commands = hostedCommands(env);
  console.log(`[local-runtime] hosting ${project} on http://${env.BIND_HOST}:${port} (MCP: /mcp/sse)`);
  if (flags.has('--dry-run')) {
    for (const { name, cwd, command } of commands) {
      console.log(`[local-runtime] ${name}: (${path.relative(repoRoot, cwd)}) ${command}`);
    }
    return;
  }
  if (!flags.has('--no-build')) {
    await runCommand(pnpmCommand, ['run', 'build:core'], env);
    await runCommand(pnpmCommand, ['--filter', 'mcp', 'build'], env);
  }
  await concurrently(commands, { prefix: 'name' }).result;
}

async function main() {
  const [mode = 'start', target] = positional;
  if (mode !== 'dev' && mode !== 'start') {
    console.error(`Unknown mode "${mode}". Expected dev or start.`);
    process.exit(1);
  }

  if (mode === 'start') {
    if (flags.has('--setup') || (process.stdin.isTTY && process.env.AIMPARENCY_HOSTED === undefined && !flags.has('--dry-run'))) {
      await setup();
    }
    if (process.env.AIMPARENCY_HOSTED === 'true') {
      return startHosted();
    }
  }
  // dev never hosts: it serves sources to the person at this machine.
  process.env.AIMPARENCY_HOSTED = 'false';

  const resolvedPorts = await resolvePorts(mode);
  // A dry run prints the config instead: writing it would repoint a running stack's frontend.
  if (flags.has('--dry-run')) {
    console.log(`[local-runtime] runtime config (dry run): ${JSON.stringify(runtimeConfig(resolvedPorts))}`);
  } else {
    await writeRuntimeConfig(resolvedPorts);
  }
  logPortSummary(resolvedPorts);
  const projectTarget = target ?? (mode === 'start' ? process.env.AIMPARENCY_PROJECT : undefined);
  if (projectTarget) {
    console.log(`[local-runtime] open: ${projectLink(projectTarget, resolvedPorts.frontendPort)}`);
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
  closeQuestions();
  if (error instanceof UsageError) {
    console.error(`[local-runtime] ${error.message}`);
    process.exit(1);
  }
  console.error('[local-runtime] Failed to start local stack.');
  console.error(error);
  process.exit(1);
});
