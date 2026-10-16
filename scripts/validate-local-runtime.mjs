import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
// The launcher's dry run prints the runtime config it would write, so this never touches the live one.
const dryRunConfigPrefix = '[local-runtime] runtime config (dry run): ';

const testPorts = {
  frontendPort: 4400,
  backendHttpPort: 3400,
  backendWsPort: 3401,
  brokerHttpPort: 5400,
  brokerWsPort: 5401,
  processStartPort: 7400,
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

function dryRunConfig(stdout) {
  const line = stdout.split('\n').find((entry) => entry.startsWith(dryRunConfigPrefix));
  assert(line, 'launcher dry-run printed no runtime config');
  return JSON.parse(line.slice(dryRunConfigPrefix.length));
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
  for (const [key, value] of Object.entries(testPorts)) {
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
  assert(typeof config.voiceEnabled === 'boolean', 'runtime-config key "voiceEnabled" is not a boolean');
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

function createScenarioEnv(overrides = {}) {
  return {
    ...process.env,
    PORT_FRONTEND: String(testPorts.frontendPort),
    PORT_BACKEND_HTTP: String(testPorts.backendHttpPort),
    PORT_BACKEND_WS: String(testPorts.backendWsPort),
    PORT_BROKER_HTTP: String(testPorts.brokerHttpPort),
    PORT_BROKER_WS: String(testPorts.brokerWsPort),
    PORT_PROCESS_START: String(testPorts.processStartPort),
    AIMPARENCY_ENABLE_VOICE: 'false',
    // Setup answers in this checkout's .env must not turn the scenarios hosted.
    AIMPARENCY_HOSTED: 'false',
    ...overrides,
  };
}

async function launch(name, mode, setupEnv) {
  const result = await runNodeScript(['scripts/run-local-stack.mjs', mode, '--no-build', '--dry-run'], setupEnv);

  console.log(`\n[scenario:${name}] exit=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`);
  if (result.stdout.trim()) {
    console.log(`[scenario:${name}] stdout:\n${result.stdout.trim()}`);
  }
  if (result.stderr.trim()) {
    console.log(`[scenario:${name}] stderr:\n${result.stderr.trim()}`);
  }
  return result;
}

async function runScenario(name, setupEnv, expectedPredicate, mode = 'start') {
  const result = await launch(name, mode, setupEnv);
  assert(result.code === 0, `launcher dry-run failed in scenario "${name}"`);

  const config = dryRunConfig(result.stdout);
  validateShape(config);
  console.log(`[scenario:${name}] runtime-config: ${formatPorts(config)}`);

  expectedPredicate(config);
}

async function main() {
  console.log('[validate-local-runtime] repo:', repoRoot);

  await runScenario('defaults-free', createScenarioEnv(), (config) => {
    for (const [key, expected] of Object.entries(testPorts)) {
      assert(config[key] === expected, `expected ${key}=${expected}, got ${config[key]}`);
    }
    assert(config.voiceEnabled === false, 'expected voice to stay disabled by default');
  });

  const reservedServers = [];
  try {
    for (const port of Object.values(testPorts)) {
      reservedServers.push(await reservePort(port));
    }

    await runScenario('defaults-occupied', createScenarioEnv(), (config) => {
      assert(config.frontendPort !== testPorts.frontendPort, 'frontend port did not fall back');
      assert(config.backendHttpPort !== testPorts.backendHttpPort, 'backend HTTP port did not fall back');
      assert(config.backendWsPort !== testPorts.backendWsPort, 'backend WS port did not fall back');
      assert(config.brokerHttpPort !== testPorts.brokerHttpPort, 'broker HTTP port did not fall back');
      assert(config.brokerWsPort !== testPorts.brokerWsPort, 'broker WS port did not fall back');
      assert(config.processStartPort !== testPorts.processStartPort, 'process start port did not fall back');
      assert(config.voiceEnabled === false, 'expected voice to stay disabled during port fallback');
    }, 'dev');

    // start keeps its ports: a proxy in front of it must not end up somewhere else.
    const strict = await launch('start-occupied', 'start', createScenarioEnv());
    assert(strict.code === 1 && /is in use/.test(strict.stderr), 'start did not refuse an occupied port');
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

  await runScenario('voice-enabled', createScenarioEnv({ AIMPARENCY_ENABLE_VOICE: 'true' }), (config) => {
    assert(config.voiceEnabled === true, 'expected voice to enable when requested');
  });

  const hostedProject = await fs.mkdtemp(path.join(os.tmpdir(), 'aimparency-hosted-'));
  try {
    const hostedEnv = createScenarioEnv({ AIMPARENCY_HOSTED: 'true', AIMPARENCY_PROJECT: hostedProject, PORT: '4410', PORT_MCP: '4411' });
    const withoutAdmin = await launch('hosted-without-admin', 'start', hostedEnv);
    assert(withoutAdmin.code === 1 && /No admin account yet/.test(withoutAdmin.stderr), 'hosted start ran without an admin');

    await fs.mkdir(path.join(hostedProject, '.bowman', 'runtime'), { recursive: true });
    await fs.writeFile(path.join(hostedProject, '.bowman', 'runtime', 'accounts.json'), JSON.stringify({ users: [{ name: 'admin', role: 'admin', passwordHash: 'x' }], tokens: [] }));
    const hosted = await launch('hosted', 'start', hostedEnv);
    assert(hosted.code === 0, 'hosted dry run failed');
    assert(/hosting .* on http:\/\/127\.0\.0\.1:4410/.test(hosted.stdout), 'hosted mode did not use its one port');
    assert(!/BROK|FRNT/.test(hosted.stdout), 'hosted mode would start the broker or the dev frontend');
  } finally {
    await fs.rm(hostedProject, { recursive: true, force: true });
  }

  console.log('\n[validate-local-runtime] PASS');
}

main().catch((error) => {
  console.error('\n[validate-local-runtime] FAIL');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
