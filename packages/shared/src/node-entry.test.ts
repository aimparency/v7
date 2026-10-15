import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withProcessFileLock } from './node-entry.js';

const counterFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'process-lock-')), 'runtime', 'counter.json');

test('withProcessFileLock serializes read-modify-write cycles: no update is lost', async () => {
  const file = counterFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '0');
  const increment = () => withProcessFileLock(file, async () => {
    const value = Number(fs.readFileSync(file, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 1)); // widen the race window
    fs.writeFileSync(file, String(value + 1));
  });
  await Promise.all(Array.from({ length: 25 }, increment));
  assert.equal(fs.readFileSync(file, 'utf8'), '25');
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test('withProcessFileLock takes over a stale lock left by a crashed holder', async () => {
  const file = counterFile();
  fs.mkdirSync(`${file}.lock`, { recursive: true });
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(`${file}.lock`, past, past);
  assert.equal(await withProcessFileLock(file, async () => 'ran'), 'ran');
});
