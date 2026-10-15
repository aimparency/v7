// Downloads and loads the local embedding model once. A fresh clone has none
// cached, and several test suites starting it at the same time race on the
// same cache directory (pnpm check runs this before them; vitest's global
// setup does the same for backend-only runs).
import { generateEmbedding } from '../src/embeddings.js';

await generateEmbedding('warm up');
