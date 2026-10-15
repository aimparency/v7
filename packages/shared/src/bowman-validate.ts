// Validates a .bowman directory against the published protocol: each file
// against its JSON Schema (protocol/schemas), plus the rules a schema cannot
// express (file name = id, known statuses, current data model version, links
// recorded on both ends). Node-only; used by `pnpm validate:bowman`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { CURRENT_DATA_MODEL_VERSION, INITIAL_STATES } from './constants.js';
import { checkGraphConsistency } from './graph-consistency.js';
import type { Idea, Phase, ProjectMeta } from './types.js';

export const PROTOCOL_SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../protocol/schemas');
// ajv-formats ships CommonJS; under ESM the plugin may sit on .default.
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as (ajv: Ajv) => Ajv;

export type BowmanValidationReport = {
  errors: string[];
  counts: { ideas: number; archivedIdeas: number; phases: number };
};

function loadValidators(): Record<'meta' | 'idea' | 'phase', ValidateFunction> {
  const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
  const compile = (name: string) => ajv.compile(JSON.parse(fs.readFileSync(path.join(PROTOCOL_SCHEMA_DIR, `${name}.schema.json`), 'utf8')));
  return { meta: compile('meta'), idea: compile('idea'), phase: compile('phase') };
}

const describeErrors = (validate: ValidateFunction) =>
  (validate.errors ?? []).map((error) => {
    const extra = error.keyword === 'additionalProperties' ? ` '${(error.params as { additionalProperty: string }).additionalProperty}'` : '';
    return `${error.instancePath || '/'} ${error.message}${extra}`;
  }).join('; ');

/** `bowmanDir`: the .bowman directory itself, or the project root containing it. */
export function validateBowman(bowmanDir: string): BowmanValidationReport {
  const root = path.basename(bowmanDir) === '.bowman' ? bowmanDir : path.join(bowmanDir, '.bowman');
  const errors: string[] = [];
  const validators = loadValidators();

  const readJson = (relative: string): unknown => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    } catch (error) {
      errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const meta = readJson('meta.json') as ProjectMeta | undefined;
  if (meta !== undefined && !validators.meta(meta)) {
    const metaVersion = (meta as { dataModelVersion?: unknown }).dataModelVersion;
    if (typeof metaVersion === 'number' && metaVersion < CURRENT_DATA_MODEL_VERSION) {
      errors.push(`meta.json: data model version ${metaVersion} is older than ${CURRENT_DATA_MODEL_VERSION}; open the project in Aimparency (or run its migrations) first`);
    } else if (typeof metaVersion === 'number' && metaVersion > CURRENT_DATA_MODEL_VERSION) {
      errors.push(`meta.json: data model version ${metaVersion} is newer than this validator (${CURRENT_DATA_MODEL_VERSION})`);
    } else {
      errors.push(`meta.json: ${describeErrors(validators.meta)}`);
    }
  }
  // An older layout fails everything below for the same single reason.
  const version = (meta as { dataModelVersion?: unknown } | undefined)?.dataModelVersion;
  if (typeof version === 'number' && version !== CURRENT_DATA_MODEL_VERSION) {
    return { errors, counts: { ideas: 0, archivedIdeas: 0, phases: 0 } };
  }

  const knownStates = new Set([...(meta?.statuses ?? INITIAL_STATES).map((state) => state.key), 'archived']);

  // Every entity file must match its schema and be named after its id.
  const readEntities = <T extends { id: string }>(dir: string, validate: ValidateFunction): { valid: T[]; unreadableIds: string[] } => {
    const valid: T[] = [];
    const unreadableIds: string[] = [];
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) return { valid, unreadableIds };
    for (const file of fs.readdirSync(absolute).filter((name) => name.endsWith('.json')).sort()) {
      const relative = `${dir}/${file}`;
      const fileId = path.basename(file, '.json');
      const entity = readJson(relative);
      if (entity === undefined) {
        unreadableIds.push(fileId);
      } else if (!validate(entity)) {
        errors.push(`${relative}: ${describeErrors(validate)}`);
        unreadableIds.push(fileId);
      } else if ((entity as T).id !== fileId) {
        errors.push(`${relative}: id ${(entity as T).id} does not match the file name`);
        unreadableIds.push(fileId);
      } else {
        valid.push(entity as T);
      }
    }
    return { valid, unreadableIds };
  };

  const ideas = readEntities<Idea>('ideas', validators.idea);
  const archivedIdeas = readEntities<Idea>('archived-ideas', validators.idea);
  const phases = readEntities<Phase>('phases', validators.phase);
  const allIdeas = [...ideas.valid, ...archivedIdeas.valid];

  for (const idea of allIdeas) {
    if (!knownStates.has(idea.status.state)) errors.push(`idea ${idea.id}: status '${idea.status.state}' is not defined in meta.json statuses`);
  }
  const duplicates = ideas.valid.filter((idea) => archivedIdeas.valid.some((archived) => archived.id === idea.id));
  for (const idea of duplicates) errors.push(`idea ${idea.id}: exists in both ideas/ and archived-ideas/`);

  // Schema failures are already reported; links to those files are not dangling.
  const unreadable = new Set([...ideas.unreadableIds, ...archivedIdeas.unreadableIds]);
  for (const issue of checkGraphConsistency(allIdeas, phases.valid, unreadable)) errors.push(issue.message);

  return {
    errors,
    counts: { ideas: ideas.valid.length, archivedIdeas: archivedIdeas.valid.length, phases: phases.valid.length }
  };
}
