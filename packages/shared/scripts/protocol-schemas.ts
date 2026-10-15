// Usage: pnpm protocol:schemas — rewrites protocol/schemas from the zod schemas.
import fs from 'node:fs';
import path from 'node:path';
import { buildProtocolSchemas, PROTOCOL_SCHEMA_DIR, serializeSchema } from '../src/protocol-schemas.js';

fs.mkdirSync(PROTOCOL_SCHEMA_DIR, { recursive: true });
for (const [fileName, schema] of Object.entries(buildProtocolSchemas())) {
  fs.writeFileSync(path.join(PROTOCOL_SCHEMA_DIR, fileName), serializeSchema(schema));
  console.log(`wrote protocol/schemas/${fileName}`);
}
