import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import concurrently from 'concurrently';
import { ask, askNewPassword, askYesNo, closeQuestions } from './ask.mjs';
import { serverDirectory } from '../packages/shared/src/server-directory.mjs';

// One launcher for the local stack. Dev runs every server from TypeScript source
// through tsx (no watchers, no build step); start builds bundles and runs those.
//
//   node scripts/run-local-stack.mjs dev|start [<repo path or git url>] [--server <name>] [--full] [--host] [--delay] [--no-build] [--port <n>] [--setup] [--dry-run]
//
//   <repo ...>  print a link that opens that project (a git URL opens read-only)
//   --server <name>  which server of this machine (default: local); its
//               directory is ~/.local/share/aimparency/<name>
//   --full      also the broker client, MCP over SSE and the voice bridge
//   --host      dev: bind to LAN_BIND_HOST (or the tailscale IP) and serve MCP over SSE
//   --delay     DEV_DELAY=true: the backend slows responses (frontend e2e tests)
//   --no-build  start: run the existing bundles without rebuilding
//   --port <n>  the frontend port, or the one port of a server with accounts
//               (otherwise "port" in the server's server.json)
//   --setup     start: ask the setup questions again
//
// dev picks free ports next to the configured ones (parallel worktrees); start
// uses exactly the configured ports, so a proxy in front of it can rely on them.
//
// A machine holds any number of servers, each named: `pnpm dev` and `pnpm
// start` run the one called "local" (no login, for the person at the machine);
// `pnpm start --server hub` runs another one, with its own accounts, graphs,
// port and settings, next to it. dev runs a server from source with hot
// reload, start runs it built, as it is deployed.
//
// The first `start` of a server in a terminal asks whether other people use
// it; the answers go to server.json in its directory. With accounts (`"login":
// "accounts"`), `start` puts the built UI, the API and the MCP server for all
// graphs on one port; everyone reads, accounts write the graphs they own or
// were given (pnpm accounts, pnpm graphs), and agents and loops stay off.
// Under a supervisor that starts it again (systemd, Restart=on-failure), set
// AIMPARENCY_SUPERVISED=true: server admins then restart it, or pull main and
// restart it, from the UI.

// The backend's exit code for "start me again" (packages/backend/src/server-restart.ts).
const RESTART_EXIT_CODE = 75;

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
// `--name value` options; what is left are flags and positionals.
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const [, value] = args.splice(index, 2);
  if (!value || value.startsWith('--')) {
    console.error(`[local-runtime] ${name} needs a value`);
    process.exit(1);
  }
  return value;
}
const portOption = option('--port');
const portOverride = parsePort(portOption, undefined);
if (portOption && !portOverride) {
  console.error('[local-runtime] --port needs a port number');
  process.exit(1);
}
// The child processes and the CLIs the setup calls work on the same server.
const serverOption = option('--server');
if (serverOption) process.env.AIMPARENCY_SERVER = serverOption;
const serverName = process.env.AIMPARENCY_SERVER || 'local';
if (!/^[a-z0-9][a-z0-9-]*$/.test(serverName)) {
  console.error(`[local-runtime] A server name has lower-case letters, digits and hyphens: "${serverName}"`);
  process.exit(1);
}
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));

// The server directory (see packages/shared/src/server-config.ts): settings,
// accounts, the list of graphs. Read here as plain JSON; the backend validates.
const serverDir = serverDirectory;
const serverSettingsFile = () => path.join(serverDir(), 'server.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const serverSettings = () => readJson(serverSettingsFile(), {});

// Merged into the file, or with `replace` written as given.
async function saveServerSettings(values, { replace = false } = {}) {
  await fs.mkdir(serverDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(serverSettingsFile(), JSON.stringify(replace ? values : { ...serverSettings(), ...values }, null, 2) + '\n');
}

// The address people open the server at; MCP clients log in by themselves and
// wallets sign in only where it is known. Also set later in the UI (Server settings).
async function askPublicUrl() {
  for (;;) {
    const answer = (await ask('The address people open (e.g. https://graphs.example.org; empty: none, then MCP clients need a link and wallets cannot log in):', serverSettings().publicUrl ?? '')).trim().replace(/\/+$/, '');
    if (!answer || /^https?:\/\/[^/\s]+/.test(answer)) return answer;
    console.log('An address starts with https:// (or http://) and a host name.');
  }
}

// The port people open: --port, the server's own setting, then .env.
const openPort = (envValue) => portOverride ?? parsePort(serverSettings().port, undefined) ?? parsePort(envValue, 4000);

const preferredPorts = {
  frontendPort: openPort(process.env.PORT_FRONTEND),
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
  const preferred = preferredPorts;
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
      throw new UsageError(`Port ${port} (${name}) is in use. Stop what uses it, pass --port <n>, set "port" in ${serverSettingsFile()}, or the PORT_* entries in .env.`);
    }
  }
}

class UsageError extends Error {}

function runtimeConfig(resolvedPorts) {
  return {
    ...resolvedPorts,
    login: serverSettings().login === 'accounts' ? 'accounts' : 'none',
    voiceEnabled: parseBoolean(process.env.AIMPARENCY_ENABLE_VOICE, false),
    generatedAt: new Date().toISOString(),
  };
}

async function writeRuntimeConfig(resolvedPorts) {
  await fs.mkdir(frontendPublicDir, { recursive: true });
  await fs.writeFile(runtimeConfigPath, JSON.stringify(runtimeConfig(resolvedPorts), null, 2) + '\n');
}

function logPortSummary(resolvedPorts) {
  console.log(`[local-runtime] server "${serverName}" (${serverDir()}), ports:`);
  console.log(`[local-runtime] frontend: http://localhost:${resolvedPorts.frontendPort}`);
  console.log(`[local-runtime] backend: http://localhost:${resolvedPorts.backendHttpPort} / ws://localhost:${resolvedPorts.backendWsPort}`);
  console.log(`[local-runtime] broker: http://localhost:${resolvedPorts.brokerHttpPort} / ws://localhost:${resolvedPorts.brokerWsPort}`);
  console.log(`[local-runtime] sessions: starting from ${resolvedPorts.processStartPort}`);
  console.log(`[local-runtime] frontend runtime config: ${path.relative(repoRoot, runtimeConfigPath)}`);
}

function createEnv(resolvedPorts) {
  return {
    ...process.env,
    // The frontend's dev server answers /runtime-config.json with this, so two
    // stacks of one checkout never read each other's ports from the file.
    AIMPARENCY_RUNTIME_CONFIG: JSON.stringify(runtimeConfig(resolvedPorts)),
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

function hasAdmin() {
  return readJson(path.join(serverDir(), 'accounts.json'), {}).accounts?.some((account) => account.serverAdmin) ?? false;
}

const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

// A git URL is cloned next to this checkout, the way someone would by hand.
async function askRepository(question, fallback = '') {
  for (;;) {
    const answer = await ask(question, fallback);
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
  console.log(`[local-runtime] Setup of the server "${serverName}". The answers go to ${serverSettingsFile()}; \`pnpm start${serverOption ? ` --server ${serverName}` : ''} --setup\` asks again.`);
  const others = await askYesNo(
    'Let other people use this server? (everyone reads; accounts create graphs and write the ones they own or were given)',
    serverSettings().login === 'accounts',
  );
  if (!others) {
    await saveServerSettings({ login: 'none' });
    await saveEnv({ AIMPARENCY_PROJECT: await askRepository('Repository to open (a path or a git URL; empty: choose in the browser):', process.env.AIMPARENCY_PROJECT ?? '') });
    return closeQuestions();
  }
  const port = parsePort(await ask('Port:', String(onePortAddress().port)), 4000);
  const host = await ask('Listen on (127.0.0.1 behind nginx, 0.0.0.0 for everyone, or a Tailscale IP):', onePortAddress().host);
  const publicUrl = await askPublicUrl();
  const signUp = serverSettings().signUp ?? {};
  const browserKey = await askYesNo('Give every visitor an account without asking, the moment they first need one? (held by a key in their browser)', signUp.browserKey === true);
  const open = await askYesNo('Let anyone sign up with a name and a password?', signUp.open === true);
  const agents = await askYesNo(
    'Let server admins run wrapped agents? That is a shell on this server for every server admin: commands as this user, /etc and the secrets in .env included.',
    serverSettings().agents === true,
  );
  const { publicUrl: _previous, ...kept } = serverSettings();
  await saveServerSettings({ ...kept, login: 'accounts', port, host, ...(publicUrl ? { publicUrl } : {}), signUp: { ...signUp, browserKey, open }, agents }, { replace: true });
  if (!hasAdmin()) {
    console.log('[local-runtime] The first account, a server admin, who manages the others in the UI:');
    const name = await ask('Name:', process.env.USER ?? 'admin');
    const password = await askNewPassword(name);
    await runCommand(tsx, ['scripts/accounts.mjs', 'add', name, '--admin'], { ...process.env, AIMPARENCY_PASSWORD: password });
  }
  const checkout = await askRepository('A repository on this machine to add as a graph (a path or a git URL; empty: none, graphs are created in the browser):');
  if (checkout) await runCommand(tsx, ['scripts/graphs.mjs', 'add', checkout], process.env).catch(() => console.log('Not added; `pnpm graphs add <path>` adds it later.'));
  closeQuestions();
}

// With accounts: the backend serves the UI, the API and (proxied) the MCP server on one port.
function onePortCommands(env, agentToken) {
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
  // Server admins' agents: the broker and its sessions stay on loopback; the
  // backend's port is their only way in, and it lets server admins through (agent-gateway).
  const agents = serverSettings().agents === true
    ? [command('BROK', 'yellow', 'wrapped-agents/broker', 'node dist/index.js', {
      BIND_HOST: '127.0.0.1',
      // The agents' Aimparency MCP (stdio, inherits this env) reaches the
      // backend as the wrapped-agents account.
      BACKEND_WS_URL: `ws://${backendHost}:${env.PORT}/trpc`,
      AIMPARENCY_TOKEN: agentToken,
    })]
    : [];
  return [
    ...agents,
    command('BACK', 'blue', 'backend', 'node dist/server.js', { AIMPARENCY_ONE_PORT: 'true' }),
    command('MCPS', 'magenta', 'mcp', 'node build/sse.js', {
      MCP_BASE_PATH: '/mcp',
      MCP_BIND_HOST: '127.0.0.1',
      BACKEND_WS_URL: `ws://${backendHost}:${env.PORT}/trpc`,
    }),
  ];
}

// Where a server with accounts listens: its own settings, then .env (PORT, BIND_HOST).
const onePortAddress = () => ({
  port: openPort(process.env.PORT),
  host: serverSettings().host || process.env.BIND_HOST || '127.0.0.1',
});

async function startOnePort() {
  const serverFlag = serverOption ? ` --server ${serverName}` : '';
  if (!hasAdmin()) {
    throw new UsageError(`No server admin account yet. Run \`pnpm start${serverFlag} --setup\` once in a terminal, or \`pnpm accounts${serverFlag} add <name> --admin\`.`);
  }
  const { port, host } = onePortAddress();
  await requireFreePorts({ port });
  // The MCP server stays on loopback behind the one port: any free port does.
  const mcpPort = parsePort(process.env.PORT_MCP, undefined) ?? await findAvailablePort(3005, new Set([port]));
  const env = {
    ...process.env,
    PORT: String(port),
    PORT_MCP: String(mcpPort),
    BIND_HOST: host,
    PATH: [path.join(repoRoot, 'node_modules', '.bin'), process.env.PATH].join(path.delimiter),
  };
  const agentToken = serverSettings().agents === true && !flags.has('--dry-run')
    ? execFileSync(tsx, ['scripts/accounts.mjs', 'agent-token'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    : '';
  const commands = onePortCommands(env, agentToken);
  console.log(`[local-runtime] server "${serverName}" with accounts (${serverDir()}) on http://${env.BIND_HOST}:${port} (MCP: /mcp/sse)`);
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
  // One process ending badly ends the stack, so a supervisor starts it anew;
  // the backend asks for that with RESTART_EXIT_CODE (packages/backend/src/server-restart.ts).
  await concurrently(commands, { prefix: 'name', killOthersOn: ['failure'] }).result.catch((events) => {
    if (Array.isArray(events) && events.some((event) => event.exitCode === RESTART_EXIT_CODE)) {
      console.log('[local-runtime] restart asked for: the supervisor starts the server again');
      process.exit(RESTART_EXIT_CODE);
    }
    throw events;
  });
}

async function main() {
  const [mode = 'start', target] = positional;
  if (mode !== 'dev' && mode !== 'start') {
    console.error(`Unknown mode "${mode}". Expected dev or start.`);
    process.exit(1);
  }

  if (mode === 'start') {
    if (flags.has('--setup') || (process.stdin.isTTY && !existsSync(serverSettingsFile()) && !flags.has('--dry-run'))) {
      await setup();
    }
    if (serverSettings().login === 'accounts') {
      return startOnePort();
    }
  }

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
