import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(packageRoot, 'src');
const require = createRequire(import.meta.url);
const tsxPackageJsonPath = require.resolve('tsx/package.json');
const tsxCliPath = path.join(path.dirname(tsxPackageJsonPath), 'dist', 'cli.mjs');

function findTestFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

const testFiles = findTestFiles(srcRoot).sort();

if (testFiles.length === 0) {
  console.error('No backend test files found under src/.');
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'test',
};

const result = spawnSync(
  process.execPath,
  [tsxCliPath, '--tsconfig', 'tsconfig.dev.json', '--test', ...testFiles],
  {
    cwd: packageRoot,
    stdio: 'inherit',
    env,
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
