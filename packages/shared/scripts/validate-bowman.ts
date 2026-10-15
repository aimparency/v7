// Usage: pnpm validate:bowman <project root or .bowman directory>
// Exits 1 when the project does not conform to the .bowman protocol.
import path from 'node:path';
import { validateBowman } from '../src/bowman-validate.js';

const target = path.resolve(process.argv[2] ?? '.');
const { errors, counts } = validateBowman(target);
for (const error of errors) console.error(error);
console.log(`${counts.ideas} ideas, ${counts.archivedIdeas} archived, ${counts.phases} phases: ${errors.length === 0 ? 'valid' : `${errors.length} problem(s)`}`);
process.exitCode = errors.length === 0 ? 0 : 1;
