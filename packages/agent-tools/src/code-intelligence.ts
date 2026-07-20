import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { cosineSimilarity } from 'shared';
import { embedDocuments, embedSearchQuery } from './association-tools.js';
import { normalizeBowmanPath, writeJsonAtomic } from './loop-state.js';

const execFileAsync = promisify(execFile);
const ignoredGlobs = [
  '!node_modules/**', '!dist/**', '!build/**', '!coverage/**', '!.git/**', '!.next/**'
];
const codeExtensions = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js',
  '.jsx', '.kt', '.md', '.php', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte',
  '.swift', '.ts', '.tsx', '.vue'
]);

type CodeChunk = {
  file: string;
  startLine: number;
  endLine: number;
  hash: string;
  text: string;
  vector: number[];
};

type CodeIndex = {
  version: 1;
  model: 'BAAI/bge-small-en-v1.5';
  createdAt: number;
  chunks: CodeChunk[];
};

function projectRoot(projectPath: string): string {
  return path.dirname(normalizeBowmanPath(projectPath));
}

async function rg(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('rg', [
      '--color', 'never',
      ...ignoredGlobs.flatMap((glob) => ['-g', glob]),
      ...args
    ], { cwd: root, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (error: any) {
    if (error.code === 1) return '';
    throw error;
  }
}

async function churnByFile(root: string): Promise<Map<string, number>> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '--numstat', '--format=', '-n', '300'], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024
    });
    const churn = new Map<string, number>();
    for (const line of stdout.split('\n')) {
      const [added, removed, file] = line.split('\t');
      if (!file || added === '-' || removed === '-') continue;
      churn.set(file, (churn.get(file) ?? 0) + Number(added) + Number(removed));
    }
    return churn;
  } catch {
    return new Map();
  }
}

function codeIndexPath(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'runtime', 'code-index.json');
}

export async function buildCodeIndex(
  projectPath: string,
  input: { maxFiles?: number; maxChunks?: number } = {}
) {
  const root = projectRoot(projectPath);
  const previous = await fs.readJson(codeIndexPath(projectPath)).catch(() => null) as CodeIndex | null;
  const previousByKey = new Map((previous?.chunks ?? []).map((chunk) => [
    `${chunk.file}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}`,
    chunk
  ]));
  const fileText = await rg(root, ['--files']);
  const files = fileText.split('\n')
    .filter(Boolean)
    .filter((file) => codeExtensions.has(path.extname(file).toLowerCase()))
    .slice(0, Math.max(1, Math.min(input.maxFiles ?? 250, 2000)));
  const pending: Omit<CodeChunk, 'vector'>[] = [];
  const maxChunks = Math.max(1, Math.min(input.maxChunks ?? 800, 5000));
  for (const file of files) {
    if (pending.length >= maxChunks) break;
    const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '');
    const lines = text.split('\n');
    for (let start = 0; start < lines.length && pending.length < maxChunks; start += 60) {
      const chunkLines = lines.slice(start, start + 80);
      const chunkText = chunkLines.join('\n').trim();
      if (!chunkText) continue;
      pending.push({
        file,
        startLine: start + 1,
        endLine: Math.min(lines.length, start + 80),
        hash: createHash('sha256').update(chunkText).digest('hex').slice(0, 16),
        text: chunkText
      });
    }
  }

  const chunks: CodeChunk[] = [];
  const needingEmbeddings: Omit<CodeChunk, 'vector'>[] = [];
  for (const chunk of pending) {
    const existing = previousByKey.get(`${chunk.file}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}`);
    if (existing?.vector.length) chunks.push(existing);
    else needingEmbeddings.push(chunk);
  }
  for (let offset = 0; offset < needingEmbeddings.length; offset += 16) {
    const batch = needingEmbeddings.slice(offset, offset + 16);
    const vectors = await embedDocuments(batch.map((chunk) => `${chunk.file}\n${chunk.text}`));
    batch.forEach((chunk, index) => {
      chunks.push({
        ...chunk,
        vector: (vectors[index] ?? []).map((value) => Number(value.toFixed(6)))
      });
    });
  }
  const index: CodeIndex = {
    version: 1,
    model: 'BAAI/bge-small-en-v1.5',
    createdAt: Date.now(),
    chunks
  };
  await writeJsonAtomic(codeIndexPath(projectPath), index);
  return {
    files: files.length,
    chunks: chunks.length,
    reused: chunks.length - needingEmbeddings.length,
    embedded: needingEmbeddings.length,
    createdAt: index.createdAt
  };
}

export async function semanticCodeSearch(projectPath: string, query: string, limit = 12) {
  if (!query.trim()) throw new Error('query is required');
  const index = await fs.readJson(codeIndexPath(projectPath)).catch(() => null) as CodeIndex | null;
  if (!index?.chunks?.length) throw new Error('No code index found. Run code_intelligence with mode=index first.');
  const queryVector = await embedSearchQuery(query);
  if (!queryVector) throw new Error('Could not embed semantic code query.');
  return index.chunks
    .filter((chunk) => chunk.vector.length === queryVector.length)
    .map((chunk) => ({
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: Number(cosineSimilarity(queryVector, chunk.vector).toFixed(4)),
      preview: chunk.text.slice(0, 500)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

export async function codeHeatmap(projectPath: string, query: string, limit = 30) {
  if (!query.trim()) throw new Error('query is required');
  const root = projectRoot(projectPath);
  const [countsText, churn] = await Promise.all([
    rg(root, ['--count-matches', '--fixed-strings', query, '.']),
    churnByFile(root)
  ]);
  const matches = countsText.split('\n').filter(Boolean).map((line) => {
    const separator = line.lastIndexOf(':');
    const file = line.slice(0, separator).replace(/^\.\//, '');
    const lexicalMatches = Number(line.slice(separator + 1)) || 0;
    const gitChurn = churn.get(file) ?? 0;
    return {
      file,
      lexicalMatches,
      gitChurn,
      score: lexicalMatches * 10 + Math.log2(gitChurn + 1)
    };
  });
  return matches.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function symbolContext(projectPath: string, symbol: string, limit = 80) {
  if (!symbol.trim()) throw new Error('symbol is required');
  const root = projectRoot(projectPath);
  const text = await rg(root, ['-n', '--word-regexp', '--fixed-strings', symbol, '.']);
  const occurrences = text.split('\n').filter(Boolean).slice(0, Math.max(1, Math.min(limit, 300)));
  const definitionPattern = new RegExp(
    `\\b(?:class|interface|type|enum|function|const|let|var|def|fn|struct|trait)\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
  );
  return {
    symbol,
    definitions: occurrences.filter((line) => definitionPattern.test(line)),
    references: occurrences.filter((line) => !definitionPattern.test(line))
  };
}

export async function changeImpact(projectPath: string, file: string, limit = 80) {
  const root = projectRoot(projectPath);
  const normalized = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes project root: ${file}`);
  }
  const stem = path.basename(normalized, path.extname(normalized));
  const [referencesText, churn] = await Promise.all([
    rg(root, ['-n', '--fixed-strings', stem, '.']),
    churnByFile(root)
  ]);
  const references = referencesText.split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith(`${normalized}:`))
    .slice(0, Math.max(1, Math.min(limit, 300)));
  return {
    file: normalized,
    gitChurn: churn.get(normalized) ?? 0,
    likelyDependents: references.filter((line) => /\b(import|from|require|use)\b/.test(line)),
    relatedTests: references.filter((line) => /(?:^|\/)(?:__tests__|test|tests)\/|[.-](?:spec|test)\./.test(line)),
    otherReferences: references.filter((line) => !/\b(import|from|require|use)\b/.test(line))
  };
}
