// Dry run of the .bowman migrations on a copy of a real project.
//
//   npm run verify:migration -- <repo or .bowman path> [--keep]
//
// Copies the .bowman (without secrets.json) to a temp dir, migrates the copy to
// the current data model and compares the graph before and after: ideas,
// connections, parent links, phase commitments and statuses must match. The
// original is never touched. Exits non-zero on any difference or conflict.
// The path may be a repo, its .bowman, or a .bowman-shaped directory (fixtures).

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateBowman, readDataModelVersion } from '../src/bowman-migration.js';
import { diffGraphSignatures, readGraphSignature } from '../src/bowman-migrations/graph-signature.js';
import { AIMPARENCY_DIR_NAME, CURRENT_DATA_MODEL_VERSION } from '../src/constants.js';
import { calculateIdeaValues } from '../src/value-calculation.js';
import { IdeaSchema } from '../src/types.js';

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith('--'));
if (!target) {
  console.error('usage: npm run verify:migration -- <repo or .bowman path> [--keep]');
  process.exit(2);
}
const isBowman = (dir: string) => ['meta.json', 'ideas', 'aims'].map((entry) => fs.access(path.join(dir, entry)).then(() => true, () => false));
const source = path.resolve((await Promise.all(isBowman(target))).some(Boolean) ? target : path.join(target, AIMPARENCY_DIR_NAME));
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-bowman-'));
const copy = path.join(workDir, AIMPARENCY_DIR_NAME);
await fs.cp(source, copy, { recursive: true, filter: (file) => path.basename(file) !== 'secrets.json' });

const before = await readGraphSignature(copy);
const result = await migrateBowman(copy);
const after = await readGraphSignature(copy);
const differences = diffGraphSignatures(before, after);

const ideas: any[] = [];
for (const dir of ['ideas', 'archived-ideas']) {
  for (const file of await fs.readdir(path.join(copy, dir)).catch(() => [] as string[])) {
    ideas.push(JSON.parse(await fs.readFile(path.join(copy, dir, file), 'utf8')));
  }
}
const schemaIssues = ideas.filter((idea) => !IdeaSchema.safeParse(idea).success).map((idea) => idea.id);
const active = ideas.filter((idea) => !idea.archived).map((idea) => IdeaSchema.safeParse(idea)).flatMap((r) => (r.success ? [r.data] : []));
let valueCalculation = 'ok';
try {
  calculateIdeaValues(active);
} catch (error) {
  valueCalculation = `failed: ${(error as Error).message}`;
}

console.log(`source:         ${source}`);
console.log(`data model:     ${result.from ?? 'none'} → ${await readDataModelVersion(copy) ?? 'none'} (current ${CURRENT_DATA_MODEL_VERSION})`);
console.log(`applied:        ${result.applied.join('; ') || 'nothing'}${result.newerThanSupported ? ' (project is newer than this code)' : ''}`);
console.log(`ideas:          ${before.active.length} active, ${before.archived.length} archived`);
console.log(`connections:    ${before.connections.length}, parent links ${before.parentLinks.length}, phase commitments ${before.commitments.length}`);
console.log(`graph:          ${differences.length === 0 ? 'unchanged' : `CHANGED in ${differences.join(', ')}`}`);
console.log(`conflicts:      ${result.conflicts.length === 0 ? 'none' : result.conflicts.join(', ')}`);
console.log(`value calc:     ${valueCalculation}`);
// Not caused by migrating (the graph check above covers that), but ideas failing
// the schema are skipped by the backend's lists, so they are worth knowing about.
console.log(`unreadable:     ${schemaIssues.length === 0 ? 'none' : `${schemaIssues.length} ideas fail IdeaSchema and are skipped by the backend: ${schemaIssues.slice(0, 5).join(', ')}`}`);

if (args.includes('--keep')) console.log(`migrated copy:  ${copy}`);
else await fs.rm(workDir, { recursive: true, force: true });

const failed = differences.length > 0 || result.conflicts.length > 0 || valueCalculation !== 'ok';
process.exit(failed ? 1 : 0);
