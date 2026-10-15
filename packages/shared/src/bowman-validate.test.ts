import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProtocolSchemas, PROTOCOL_SCHEMA_DIR, serializeSchema } from './protocol-schemas.js';
import { validateBowman } from './bowman-validate.js';
import { CURRENT_DATA_MODEL_VERSION } from './constants.js';

const PARENT = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const PHASE = '33333333-3333-4333-8333-333333333333';

const idea = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  text: id,
  supportedIdeas: [],
  committedIn: [],
  status: { state: 'open', comment: '', date: 0 },
  ...fields
});

function project(edit: (files: Record<string, any>) => void = () => {}) {
  const files: Record<string, any> = {
    'meta.json': { name: 'test', color: '#336699', dataModelVersion: CURRENT_DATA_MODEL_VERSION },
    [`ideas/${PARENT}.json`]: idea(PARENT, { supportingConnections: [{ ideaId: CHILD, relativePosition: [2.5, 0], weight: 1 }], committedIn: [PHASE] }),
    [`ideas/${CHILD}.json`]: idea(CHILD, { supportedIdeas: [PARENT] }),
    [`phases/${PHASE}.json`]: { id: PHASE, name: 'now', parent: null, commitments: [PARENT] }
  };
  edit(files);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bowman-validate-'));
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, '.bowman', relative)), { recursive: true });
    fs.writeFileSync(path.join(root, '.bowman', relative), JSON.stringify(content));
  }
  return root;
}

test('published schemas match the zod schemas they are generated from (run pnpm protocol:schemas)', () => {
  for (const [fileName, schema] of Object.entries(buildProtocolSchemas())) {
    assert.equal(fs.readFileSync(path.join(PROTOCOL_SCHEMA_DIR, fileName), 'utf8'), serializeSchema(schema), fileName);
  }
});

test('a minimal consistent project is valid, from the root or the .bowman directory', () => {
  const root = project();
  assert.deepEqual(validateBowman(root), { errors: [], counts: { ideas: 2, archivedIdeas: 0, phases: 1 } });
  assert.deepEqual(validateBowman(path.join(root, '.bowman')).errors, []);
});

test('reports schema, naming, status and one-sided link problems', () => {
  const root = project((files) => {
    files[`ideas/${CHILD}.json`].supportedIdeas = []; // parent → child recorded on one end only
    files[`ideas/${CHILD}.json`].priority = 3; // not part of the format
    files[`ideas/${PARENT}.json`].status.state = 'someday'; // not a defined status
    files[`phases/${PHASE}.json`].commitments = []; // committedIn without the phase's commitment
  });
  const { errors } = validateBowman(root);
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.match(errors.join('\n'), /additional properties 'priority'/);
  assert.match(errors.join('\n'), /status 'someday' is not defined/);
  assert.match(errors.join('\n'), /does not have it in commitments/);
  // The child failed its schema, so the link to it is not also reported as one-sided.
});

test('a file must be named after the id it contains', () => {
  const root = project((files) => {
    files[`ideas/${PARENT}.json`].id = '44444444-4444-4444-8444-444444444444';
  });
  assert.match(validateBowman(root).errors.join('\n'), /does not match the file name/);
});

test('an older data model version is reported alone, not as a cascade of link errors', () => {
  const root = project((files) => {
    files['meta.json'].dataModelVersion = 2;
    delete files[`ideas/${CHILD}.json`];
  });
  const { errors } = validateBowman(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /older than/);
});
