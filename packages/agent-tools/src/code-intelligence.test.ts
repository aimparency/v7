import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCodeIndex,
  changeImpact,
  codeHeatmap,
  semanticCodeSearch,
  symbolContext
} from './code-intelligence.js';

test('maps terms, symbols, and likely file impact', async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), 'aimparency-code-map-'));
  try {
    await mkdir(path.join(projectPath, '.bowman'));
    await mkdir(path.join(projectPath, 'src'));
    await mkdir(path.join(projectPath, 'tests'));
    await writeFile(path.join(projectPath, 'src', 'signal.ts'), [
      'export function observeSignal() {',
      "  return 'economic signal'",
      '}'
    ].join('\n'));
    await writeFile(path.join(projectPath, 'src', 'consumer.ts'), [
      "import { observeSignal } from './signal'",
      'export const value = observeSignal()'
    ].join('\n'));
    await writeFile(path.join(projectPath, 'tests', 'signal.test.ts'), [
      "import { observeSignal } from '../src/signal'",
      'void observeSignal()'
    ].join('\n'));

    const heatmap = await codeHeatmap(projectPath, 'signal');
    assert.ok(heatmap.some((entry) => entry.file === 'src/signal.ts' && entry.lexicalMatches > 0));

    const context = await symbolContext(projectPath, 'observeSignal');
    assert.equal(context.definitions.length, 1);
    assert.ok(context.references.length >= 2);

    const impact = await changeImpact(projectPath, 'src/signal.ts');
    assert.ok(impact.likelyDependents.some((line) => line.includes('consumer.ts')));
    assert.ok(impact.relatedTests.some((line) => line.includes('signal.test.ts')));

    const indexed = await buildCodeIndex(projectPath, { maxFiles: 10, maxChunks: 10 });
    assert.equal(indexed.files, 3);
    assert.equal(indexed.embedded, indexed.chunks);
    const semantic = await semanticCodeSearch(projectPath, 'observe an economic measurement');
    assert.ok(semantic.some((result) => result.file === 'src/signal.ts'));

    const unchanged = await buildCodeIndex(projectPath, { maxFiles: 10, maxChunks: 10 });
    assert.equal(unchanged.embedded, 0);
    assert.equal(unchanged.reused, unchanged.chunks);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
