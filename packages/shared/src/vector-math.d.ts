/**
 * Vector mathematics for embedding comparisons.
 */
export declare function dotProduct(a: number[], b: number[]): number;
export declare function magnitude(a: number[]): number;
/**
 * Calculates cosine similarity between two vectors.
 * Range: [-1, 1]
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Calculates cosine distance.
 * Range: [0, 2]
 * 0 means identical, 1 means orthogonal, 2 means opposite.
 */
export declare function cosineDistance(a: number[], b: number[]): number;
//# sourceMappingURL=vector-math.d.ts.map