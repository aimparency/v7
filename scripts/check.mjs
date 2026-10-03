#!/usr/bin/env node
// One command for "is the repo green?": every workspace's typecheck and test
// script, plus the hook tests, run in parallel. Workspaces are discovered from
// the root package.json, so a new package is checked once it has the scripts.
//
//   npm run check                      everything
//   npm run check -- test              only tests (or: typecheck)
//   npm run check -- backend frontend  only these workspaces (combinable)

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const KINDS = { typecheck: ['typecheck', 'type-check'], test: ['test'] };

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
    if (kind === 'test' && (names.length === 0 || names.includes('hooks'))) {
      tasks.push({ label: 'test hooks', cwd: root, script: 'test:hooks' });
    }
  }
  return tasks;
}

function run(task) {
  const started = Date.now();
  return new Promise((resolve) => {
    // CI=1 keeps watch-capable runners (vitest) in run-once mode.
    const child = spawn('npm', ['run', task.script], { cwd: task.cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
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
const results = await runAll(tasks, Math.max(2, Math.floor(os.availableParallelism() / 2)));
const failed = results.filter((result) => !result.ok);
for (const result of failed) {
  console.log(`\n── ${result.label} (npm run ${result.script}) ──\n${result.output.trimEnd().split('\n').slice(-60).join('\n')}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((result) => result.label).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
