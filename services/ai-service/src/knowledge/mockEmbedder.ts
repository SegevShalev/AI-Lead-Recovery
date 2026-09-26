import { assertNonEmptyTexts, type Embedder } from "./embedder.js";

const MOCK_DIMENSIONS = 256;

/**
 * Deterministic, key-free embedder for local dev and tests
 * (EMBEDDING_PROVIDER=mock, the default).
 *
 * "Feature hashing": every word and every 3-letter piece of a word is hashed
 * into one of 256 slots (with a +/- sign, so collisions tend to cancel out
 * instead of piling up), then the vector is scaled to length 1. Texts that
 * share words/pieces point in similar directions, so similarity tests mean
 * something. The 3-letter pieces matter for Hebrew: "בלמים" and "הבלמים"
 * are different words but share most pieces.
 *
 * It is purely lexical - it knows nothing about meaning, so "הרכב חורק"
 * won't find "רפידות בלמים". Only the real embedder can be evaluated for
 * retrieval quality (Stage 7).
 */
export class MockEmbedder implements Embedder {
  readonly model = `mock-hash-${MOCK_DIMENSIONS}`;
  readonly dimensions = MOCK_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    assertNonEmptyTexts(texts);
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const feature of features(text)) {
      const hash = fnv1a(feature);
      const slot = hash % this.dimensions;
      const sign = hash >>> 31 === 0 ? 1 : -1;
      vector[slot]! += sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    // A text of only punctuation has no features; any fixed unit vector keeps it valid.
    if (norm === 0) return vector.map((_, i) => (i === 0 ? 1 : 0));
    return vector.map((value) => value / norm);
  }
}

function features(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  const result: string[] = [];
  for (const word of words) {
    result.push(`w:${word}`);
    const padded = `^${word}$`;
    for (let i = 0; i + 3 <= padded.length; i++) result.push(`g:${padded.slice(i, i + 3)}`);
  }
  return result;
}

/** FNV-1a, 32-bit: tiny, fast, stable across runs and machines. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
