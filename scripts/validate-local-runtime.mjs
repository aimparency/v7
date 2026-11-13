import fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
// The launcher's dry run prints the runtime config it would write, so this never touches the live one.
const scenarioServerDir = mkdtempSync(path.join(os.tmpdir(), 'aimparency-validate-server-'));
process.on('exit', () => rmSync(scenarioServerDir, { recursive: true, force: true }));

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
    // The scenarios run as a server of their own, never as this machine's.
    AIMPARENCY_SERVER_DIR: scenarioServerDir,
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

  // With accounts: one port, no dev frontend, the broker only for the server admins' agents.
  const accountsEnv = createScenarioEnv({ PORT: '4410', PORT_MCP: '4411' });
  const settings = (values) => fs.writeFile(path.join(scenarioServerDir, 'server.json'), JSON.stringify({ login: 'accounts', ...values }));
  await settings({});
  const withoutAdmin = await launch('accounts-without-admin', 'start', accountsEnv);
  assert(withoutAdmin.code === 1 && /No server admin account yet/.test(withoutAdmin.stderr), 'a server with accounts started without a server admin');

  await fs.writeFile(path.join(scenarioServerDir, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'a', name: 'admin', serverAdmin: true }], tokens: [] }));
  const onePort = await launch('accounts', 'start', accountsEnv);
  assert(onePort.code === 0, 'dry run of a server with accounts failed');
  assert(/with accounts .* on http:\/\/127\.0\.0\.1:4410/.test(onePort.stdout), 'a server with accounts did not use its one port');
  assert(!/BROK|FRNT/.test(onePort.stdout), 'a server with accounts would start the broker or the dev frontend');
  await settings({ agents: true });
  const withAgents = await launch('accounts-agents', 'start', accountsEnv);
  assert(withAgents.code === 0, 'dry run with agents failed');
  assert(/BROK: \(packages\/wrapped-agents\/broker\) node dist\/index\.js/.test(withAgents.stdout), 'server admins\' agents did not start the broker');
  assert(!/FRNT/.test(withAgents.stdout), 'a server with accounts and agents would start the dev frontend');

  // Servers have names: each has its own directory, and its port is in its server.json.
  const dataHome = path.join(scenarioServerDir, 'data');
  const named = createScenarioEnv({ AIMPARENCY_SERVER_DIR: '', XDG_DATA_HOME: dataHome });
  await fs.mkdir(path.join(dataHome, 'aimparency-hub'), { recursive: true });
  await fs.writeFile(path.join(dataHome, 'aimparency-hub', 'server.json'), JSON.stringify({ login: 'accounts', port: 4420, host: '127.0.0.2' }));
  await fs.writeFile(path.join(dataHome, 'aimparency-hub', 'accounts.json'), JSON.stringify({ accounts: [{ id: 'a', name: 'admin', serverAdmin: true }], tokens: [] }));
  const hub = await runNodeScript(['scripts/run-local-stack.mjs', 'start', '--server', 'hub', '--no-build', '--dry-run'], named);
  assert(hub.code === 0 && /server "hub" with accounts .*aimparency-hub\) on http:\/\/127\.0\.0\.2:4420/.test(hub.stdout), `the server "hub" did not use its own directory, port and host:\n${hub.stdout}${hub.stderr}`);

  // Without a name it is the server "local": the stack of the person at this machine, next to the other.
  const local = await launch('local-next-to-hub', 'dev', named);
  assert(local.code === 0 && /server "local" .*aimparency-local\)/.test(local.stdout) && /FRNT/.test(local.stdout), 'dev did not start the local server');
  const badName = await runNodeScript(['scripts/run-local-stack.mjs', 'start', '--server', '../x', '--dry-run'], named);
  assert(badName.code === 1, 'a server name that leaves the data directory was accepted');

  console.log('\n[validate-local-runtime] PASS');
}

main().catch((error) => {
  console.error('\n[validate-local-runtime] FAIL');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
