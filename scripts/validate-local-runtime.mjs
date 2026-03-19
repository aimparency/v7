import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const runtimeConfigPath = path.join(repoRoot, 'packages', 'frontend', 'public', 'runtime-config.json');

const expectedDefaults = {
  frontendPort: 4000,
  backendHttpPort: 3000,
  backendWsPort: 3001,
  brokerHttpPort: 5000,
  brokerWsPort: 5001,
  processStartPort: 7000,
};

function runNodeScript(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function readRuntimeConfig() {
  const raw = await fs.readFile(runtimeConfigPath, 'utf8');
  return JSON.parse(raw);
}

function formatPorts(config) {
  return [
    `frontend=${config.frontendPort}`,
    `backendHttp=${config.backendHttpPort}`,
    `backendWs=${config.backendWsPort}`,
    `brokerHttp=${config.brokerHttpPort}`,
    `brokerWs=${config.brokerWsPort}`,
    `processStart=${config.processStartPort}`,
  ].join(', ');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateShape(config) {
  for (const [key, value] of Object.entries(expectedDefaults)) {
    assert(Number.isInteger(config[key]), `runtime-config key "${key}" is not an integer`);
    assert(config[key] > 0, `runtime-config key "${key}" is not a positive port`);
    assert(typeof value === 'number', 'internal expected default mismatch');
  }

  const uniquePorts = new Set([
    config.frontendPort,
    config.backendHttpPort,
    config.backendWsPort,
    config.brokerHttpPort,
    config.brokerWsPort,
    config.processStartPort,
  ]);

  assert(uniquePorts.size === 6, 'runtime-config ports are not unique');
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

async function removeRuntimeConfigIfPresent() {
  await fs.rm(runtimeConfigPath, { force: true });
}

async function runScenario(name, setupEnv = process.env, expectedPredicate) {
  await removeRuntimeConfigIfPresent();

  const result = await runNodeScript(['scripts/run-local-stack.mjs', 'start:fast', '--dry-run'], setupEnv);

  console.log(`\n[scenario:${name}] exit=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`);
  if (result.stdout.trim()) {
    console.log(`[scenario:${name}] stdout:\n${result.stdout.trim()}`);
  }
  if (result.stderr.trim()) {
    console.log(`[scenario:${name}] stderr:\n${result.stderr.trim()}`);
  }

  assert(result.code === 0, `launcher dry-run failed in scenario "${name}"`);

  const config = await readRuntimeConfig();
  validateShape(config);
  console.log(`[scenario:${name}] runtime-config: ${formatPorts(config)}`);

  expectedPredicate(config);
}

async function main() {
  console.log('[validate-local-runtime] repo:', repoRoot);
  console.log('[validate-local-runtime] runtime-config path:', runtimeConfigPath);

  await runScenario('defaults-free', process.env, (config) => {
    for (const [key, expected] of Object.entries(expectedDefaults)) {
      assert(config[key] === expected, `expected ${key}=${expected}, got ${config[key]}`);
    }
  });

  const reservedServers = [];
  try {
    for (const port of Object.values(expectedDefaults)) {
      reservedServers.push(await reservePort(port));
    }

    await runScenario('defaults-occupied', process.env, (config) => {
      assert(config.frontendPort !== expectedDefaults.frontendPort, 'frontend port did not fall back');
      assert(config.backendHttpPort !== expectedDefaults.backendHttpPort, 'backend HTTP port did not fall back');
      assert(config.backendWsPort !== expectedDefaults.backendWsPort, 'backend WS port did not fall back');
      assert(config.brokerHttpPort !== expectedDefaults.brokerHttpPort, 'broker HTTP port did not fall back');
      assert(config.brokerWsPort !== expectedDefaults.brokerWsPort, 'broker WS port did not fall back');
      assert(config.processStartPort !== expectedDefaults.processStartPort, 'process start port did not fall back');
    });
  } finally {
    await Promise.all(
      reservedServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }))
    );
  }

  console.log('\n[validate-local-runtime] PASS');
}

main().catch((error) => {
  console.error('\n[validate-local-runtime] FAIL');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
