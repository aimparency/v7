import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const frontendPublicDir = path.join(repoRoot, 'packages', 'frontend', 'public');
const runtimeConfigPath = path.join(frontendPublicDir, 'runtime-config.json');

const modes = {
  dev: {
    preflight: [['npm', ['run', 'dev:mobile:config']]],
    script: 'dev:stack',
  },
  start: {
    preflight: [['npm', ['run', 'build:core']]],
    script: 'start:stack',
  },
  'start:fast': {
    preflight: [],
    script: 'start:stack',
  },
};

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

async function writeRuntimeConfig(resolvedPorts) {
  await fs.mkdir(frontendPublicDir, { recursive: true });
  await fs.writeFile(runtimeConfigPath, JSON.stringify({
    ...resolvedPorts,
    voiceEnabled: parseBoolean(process.env.AIMPARENCY_ENABLE_VOICE, false),
    generatedAt: new Date().toISOString(),
  }, null, 2) + '\n');
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

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} exited via signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
        return;
      }

      resolve();
    });

    child.on('error', reject);
  });
}

async function main() {
  const mode = process.argv[2] ?? 'start';
  const dryRun = process.argv.includes('--dry-run');
  const config = modes[mode];

  if (!config) {
    console.error(`Unknown mode "${mode}". Expected one of: ${Object.keys(modes).join(', ')}`);
    process.exit(1);
  }

  const resolvedPorts = await resolvePorts();
  await writeRuntimeConfig(resolvedPorts);
  logPortSummary(resolvedPorts);

  if (dryRun) {
    return;
  }

  const env = createEnv(resolvedPorts);

  for (const [command, args] of config.preflight) {
    await runCommand(command, args, env);
  }

  await runCommand('npm', ['run', config.script], env);
}

main().catch((error) => {
  console.error('[local-runtime] Failed to start local stack.');
  console.error(error);
  process.exit(1);
});
