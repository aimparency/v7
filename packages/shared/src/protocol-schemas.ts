// Builds the published JSON Schemas of the .bowman format (protocol/schemas)
// from the zod schemas the code uses, so the spec cannot drift from the code.
// Written by `pnpm protocol:schemas`; bowman-validate.test.ts fails on drift.
import { z } from 'zod';
import { CURRENT_DATA_MODEL_VERSION } from './constants.js';
import { IdeaSchema, PhaseSchema, ProjectMetaSchema } from './types.js';

export { PROTOCOL_SCHEMA_DIR } from './bowman-validate.js';

type JsonSchema = Record<string, any>;

const describe = (fileName: string, title: string, description: string, schema: z.ZodType): JsonSchema => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://github.com/aimparency/v7/blob/main/protocol/schemas/${fileName}`,
  title,
  description: `${description} Data model version ${CURRENT_DATA_MODEL_VERSION}.`,
  // io 'input': what a file may contain (defaults filled in on read are optional).
  ...closeObjects(withoutSchemaKeyword(z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as JsonSchema))
});

// The published format lists every field it knows: other tools should not
// invent new ones (the readers here drop unknown fields).
function closeObjects(node: any): any {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (!node || typeof node !== 'object') return node;
  const closed = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, closeObjects(value)]));
  if (closed.type === 'object' && closed.properties && closed.additionalProperties === undefined) closed.additionalProperties = false;
  return closed;
}

function withoutSchemaKeyword({ $schema: _ignored, ...rest }: JsonSchema): JsonSchema {
  return rest;
}

export function buildProtocolSchemas(): Record<string, JsonSchema> {
  const meta = describe('meta.schema.json', 'Aimparency project meta', '.bowman/meta.json: project settings and the data model version.', ProjectMetaSchema);
  // Optional while reading legacy projects; a valid current project states it.
  meta.properties.dataModelVersion = { ...meta.properties.dataModelVersion, const: CURRENT_DATA_MODEL_VERSION };
  meta.required = [...(meta.required ?? []), 'dataModelVersion'];

  return {
    'meta.schema.json': meta,
    'idea.schema.json': describe('idea.schema.json', 'Aimparency idea', '.bowman/ideas/<id>.json and .bowman/archived-ideas/<id>.json: one idea and its outgoing links.', IdeaSchema),
    'phase.schema.json': describe('phase.schema.json', 'Aimparency phase', '.bowman/phases/<id>.json: one phase and the ideas committed to it.', PhaseSchema)
  };
}

export const serializeSchema = (schema: JsonSchema) => `${JSON.stringify(schema, null, 2)}\n`;
