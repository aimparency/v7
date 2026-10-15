import { generateEmbedding } from './src/embeddings.js';

// A fresh clone has no cached embedding model; its first use downloads it, which
// outlasts per-test timeouts. Fetch it once here, where no timeout applies.
export default async function warmEmbeddingModel() {
  await generateEmbedding('warm up');
}
