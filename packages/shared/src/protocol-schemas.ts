// Builds the published JSON Schemas of the .bowman format (protocol/schemas)
// from the zod schemas the code uses, so the spec cannot drift from the code.
// Written by `pnpm protocol:schemas`; bowman-validate.test.ts fails on drift.
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CURRENT_DATA_MODEL_VERSION } from './constants.js';
import { IdeaSchema, PhaseSchema, ProjectMetaSchema } from './types.js';

export { PROTOCOL_SCHEMA_DIR } from './bowman-validate.js';

type JsonSchema = Record<string, any>;

const describe = (fileName: string, title: string, description: string, schema: ZodTypeAny): JsonSchema => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://github.com/aimparency/v7/blob/main/protocol/schemas/${fileName}`,
  title,
  description: `${description} Data model version ${CURRENT_DATA_MODEL_VERSION}.`,
  ...withoutSchemaKeyword(zodToJsonSchema(schema as any, { target: 'jsonSchema7', $refStrategy: 'none' }) as JsonSchema)
});

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
