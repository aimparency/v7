import { execFile, exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { normalizeBowmanPath } from './loop-state.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export type CommandResult = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  refused?: string;
};

function projectRoot(projectPath: string): string {
  return path.dirname(normalizeBowmanPath(projectPath));
}

function resolveInsideProject(projectPath: string, relativePath: string): string {
  const root = projectRoot(projectPath);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return resolved;
}

function rel(projectPath: string, filePath: string): string {
  return path.relative(projectRoot(projectPath), filePath);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

export async function listFiles(projectPath: string, input: { directory?: string; limit?: number } = {}) {
  const root = projectRoot(projectPath);
  const cwd = input.directory ? resolveInsideProject(projectPath, input.directory) : root;
  const limit = input.limit ?? 500;
  try {
    const { stdout } = await execFileAsync('rg', ['--files'], { cwd, maxBuffer: 4 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean).slice(0, limit).map((file) => rel(projectPath, path.join(cwd, file)));
  } catch {
    const files = await fs.readdir(cwd);
    return files.slice(0, limit).map((file) => rel(projectPath, path.join(cwd, file)));
  }
}

export async function searchFiles(projectPath: string, input: {
  query: string;
  directory?: string;
  context?: number;
  glob?: string;
  limitChars?: number;
}) {
  const cwd = input.directory ? resolveInsideProject(projectPath, input.directory) : projectRoot(projectPath);
  const args = ['-n', '--line-number', '-C', String(Math.max(0, Math.min(input.context ?? 2, 20)))];
  if (input.glob) args.push('-g', input.glob);
  args.push(input.query);
  try {
    const { stdout, stderr } = await execFileAsync('rg', args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: truncate(stdout, input.limitChars ?? 20000), stderr };
  } catch (error: any) {
    return {
      stdout: truncate(error.stdout ?? '', input.limitChars ?? 20000),
      stderr: error.stderr ?? ''
    };
  }
}

export async function readFileRange(projectPath: string, input: { path: string; startLine?: number; maxLines?: number }) {
  const file = resolveInsideProject(projectPath, input.path);
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const start = Math.max(1, input.startLine ?? 1);
  const count = Math.max(1, Math.min(input.maxLines ?? 200, 1000));
  const selected = lines.slice(start - 1, start - 1 + count);
  return selected.map((line, index) => `${start + index}: ${line}`).join('\n');
}

export async function gitStatus(projectPath: string) {
  const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: projectRoot(projectPath) });
  return stdout;
}

export async function gitDiff(projectPath: string, input: { path?: string; staged?: boolean; limitChars?: number } = {}) {
  const args = ['diff'];
  if (input.staged) args.push('--staged');
  if (input.path) args.push('--', input.path);
  const { stdout } = await execFileAsync('git', args, { cwd: projectRoot(projectPath), maxBuffer: 16 * 1024 * 1024 });
  return truncate(stdout, input.limitChars ?? 30000);
}

function classifyCommand(command: string): string | null {
  const risky = [
    /\brm\s+-rf\b/,
    /\bgit\s+reset\b/,
    /\bgit\s+checkout\s+--\b/,
    /\bsudo\b/,
    /\bmkfs\b/,
    /\bdd\s+/,
    /:\(\)\s*\{\s*:\|:/,
    />\s*\/dev\/sd/,
  ];
  if (risky.some((pattern) => pattern.test(command))) return 'Refused risky/destructive command.';
  return null;
}

export async function runCommand(projectPath: string, input: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}): Promise<CommandResult> {
  const refused = classifyCommand(input.command);
  const cwd = input.cwd ? resolveInsideProject(projectPath, input.cwd) : projectRoot(projectPath);
  if (refused) {
    return { command: input.command, cwd: rel(projectPath, cwd), exitCode: 126, stdout: '', stderr: '', refused };
  }
  try {
    const { stdout, stderr } = await execAsync(input.command, {
      cwd,
      timeout: Math.min(input.timeoutMs ?? 30000, 120000),
      maxBuffer: 16 * 1024 * 1024
    });
    return {
      command: input.command,
      cwd: rel(projectPath, cwd) || '.',
      exitCode: 0,
      stdout: truncate(stdout, input.maxOutputChars ?? 30000),
      stderr: truncate(stderr, input.maxOutputChars ?? 30000)
    };
  } catch (error: any) {
    return {
      command: input.command,
      cwd: rel(projectPath, cwd) || '.',
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stdout: truncate(error.stdout ?? '', input.maxOutputChars ?? 30000),
      stderr: truncate(error.stderr ?? error.message ?? '', input.maxOutputChars ?? 30000)
    };
  }
}

export function proposePatch(input: { summary: string; unifiedDiff: string }) {
  return input;
}

function runWithStdin(command: string, args: string[], cwd: string, input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

export async function applyUnifiedPatch(projectPath: string, input: { unifiedDiff: string }) {
  const root = projectRoot(projectPath);
  await runWithStdin('git', ['apply', '--check', '-'], root, input.unifiedDiff);
  await runWithStdin('git', ['apply', '-'], root, input.unifiedDiff);
  return { applied: true };
}

export async function strReplace(projectPath: string, input: { path: string; oldString: string; newString: string }) {
  const file = resolveInsideProject(projectPath, input.path);
  const text = await fs.readFile(file, 'utf8');
  const first = text.indexOf(input.oldString);
  if (first < 0) throw new Error('oldString not found');
  if (text.indexOf(input.oldString, first + input.oldString.length) >= 0) throw new Error('oldString is not unique');
  await fs.writeFile(file, text.slice(0, first) + input.newString + text.slice(first + input.oldString.length));
  return { path: input.path, replaced: true };
}

export async function lineReplace(projectPath: string, input: {
  path: string;
  startLine: number;
  lineCount: number;
  expectedFirstLine: string;
  expectedLastLine: string;
  replacement: string;
}) {
  const file = resolveInsideProject(projectPath, input.path);
  const text = await fs.readFile(file, 'utf8');
  const hasTrailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (hasTrailingNewline) lines.pop();
  const startIndex = input.startLine - 1;
  const endIndex = startIndex + input.lineCount - 1;
  if (startIndex < 0 || endIndex >= lines.length) throw new Error('Line range out of bounds');
  if (lines[startIndex] !== input.expectedFirstLine) throw new Error(`First line mismatch at ${input.startLine}`);
  if (lines[endIndex] !== input.expectedLastLine) throw new Error(`Last line mismatch at ${input.startLine + input.lineCount - 1}`);
  const replacementLines = input.replacement.length > 0 ? input.replacement.split('\n') : [];
  lines.splice(startIndex, input.lineCount, ...replacementLines);
  await fs.writeFile(file, `${lines.join('\n')}${hasTrailingNewline ? '\n' : ''}`);
  return { path: input.path, startLine: input.startLine, lineCount: input.lineCount, replaced: true };
}
