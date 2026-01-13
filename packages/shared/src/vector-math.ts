/**
 * Vector mathematics for embedding comparisons.
 */

export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

export function magnitude(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const val = a[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Calculates cosine similarity between two vectors.
 * Range: [-1, 1]
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = dotProduct(a, b);
  const normA = magnitude(a);
  const normB = magnitude(b);
  if (normA === 0 || normB === 0) return 0;
  
  // Floating point precision safety
  const similarity = dot / (normA * normB);
  return Math.max(-1, Math.min(1, similarity));
}

/**
 * Calculates cosine distance.
 * Range: [0, 2]
 * 0 means identical, 1 means orthogonal, 2 means opposite.
 */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}
