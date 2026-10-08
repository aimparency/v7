#!/usr/bin/env node
// One command for "is the repo green?": every workspace's typecheck and test
// script, plus the hook tests and knip (unused files, exports, dependencies),
// run in parallel. Workspaces are discovered from the root package.json, so a
// new package is checked once it has the scripts.
//
//   npm run check                      everything
//   npm run check -- test              only tests (or: typecheck, unused)
//   npm run check -- backend frontend  only these workspaces (combinable)
//
// Parallelism follows free memory as well as cores, since the dev stack usually
// runs alongside: CHECK_CONCURRENCY overrides the job count, VITEST_MAX_WORKERS
// the workers per vitest job (default 2).

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const KINDS = { typecheck: ['typecheck', 'type-check'], test: ['test'], unused: [] };

// Repo-wide tasks, run from the root.
const ROOT_TASKS = [
  { kind: 'test', name: 'hooks', script: 'test:hooks' },
  { kind: 'unused', name: 'knip', script: 'knip' },
];

function workspaces() {
  return readJson(path.join(root, 'package.json')).workspaces.flatMap((pattern) => {
    const parent = path.join(root, pattern.replace(/\/\*$/, ''));
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(parent, entry.name, 'package.json')))
      .map((entry) => {
        const dir = path.join(parent, entry.name);
        const pkg = readJson(path.join(dir, 'package.json'));
        return { name: pkg.name, short: entry.name, dir, scripts: pkg.scripts ?? {} };
      });
  });
}

function plan(args) {
  const kinds = args.filter((arg) => arg in KINDS);
  const names = args.filter((arg) => !(arg in KINDS));
  const wanted = (workspace) => names.length === 0 || names.includes(workspace.short) || names.includes(workspace.name);
  const tasks = [];
  for (const kind of kinds.length ? kinds : Object.keys(KINDS)) {
    for (const workspace of workspaces().filter(wanted)) {
      const script = KINDS[kind].find((candidate) => workspace.scripts[candidate]);
      if (script) tasks.push({ label: `${kind} ${workspace.short}`, cwd: workspace.dir, script });
    }
    for (const task of ROOT_TASKS.filter((task) => task.kind === kind && (names.length === 0 || names.includes(task.name)))) {
      tasks.push({ label: `${kind} ${task.name}`, cwd: root, script: task.script });
    }
  }
  return tasks;
}

function run(task) {
  const started = Date.now();
  return new Promise((resolve) => {
    // CI=1 keeps watch-capable runners (vitest) in run-once mode.
    const child = spawn('npm', ['run', task.script], {
      cwd: task.cwd,
      env: { VITEST_MAX_WORKERS: '2', ...process.env, CI: '1', FORCE_COLOR: '0' }
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ ...task, ok: code === 0, output, seconds: (Date.now() - started) / 1000 }));
  });
}

async function runAll(tasks, concurrency) {
  const results = [];
  const queue = [...tasks];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const result = await run(task);
      console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.label.padEnd(36)} ${result.seconds.toFixed(1)}s`);
      results.push(result);
    }
  }));
  return results;
}

const tasks = plan(process.argv.slice(2));
if (tasks.length === 0) {
  console.error('Nothing to check: no matching workspace scripts.');
  process.exit(1);
}
// A job (vue-tsc, or vitest with its workers) peaks around 1.5 GB.
const JOB_MEMORY_BYTES = 1.5 * 1024 ** 3;
const concurrency = Number(process.env.CHECK_CONCURRENCY) || Math.max(1, Math.min(
  Math.floor(os.availableParallelism() / 2),
  Math.floor(os.freemem() / JOB_MEMORY_BYTES)
));
console.log(`${tasks.length} tasks, ${concurrency} at a time (${(os.freemem() / 1024 ** 3).toFixed(1)} GB free)`);
const results = await runAll(tasks, concurrency);
const failed = results.filter((result) => !result.ok);
for (const result of failed) {
  console.log(`\n── ${result.label} (npm run ${result.script}) ──\n${result.output.trimEnd().split('\n').slice(-60).join('\n')}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((result) => result.label).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
