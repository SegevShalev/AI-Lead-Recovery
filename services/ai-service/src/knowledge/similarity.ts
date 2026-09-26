/**
 * Cosine similarity: 1 = same direction, 0 = unrelated, -1 = opposite.
 * Only the angle counts, not the length - [0.45, 0.05] scores the same as
 * [0.9, 0.1] (playground Part 1, question 4). Qdrant computes the same thing
 * for a collection with `distance: "Cosine"`.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
