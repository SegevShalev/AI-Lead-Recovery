/**
 * Text → vector, behind an interface so provider SDK/HTTP details never leak
 * past this file's implementations (AGENTS.md AI rule 3).
 */
export interface Embedder {
  /** Stored on every point and part of the collection name, so vectors from different models never mix. */
  readonly model: string;
  /** Length of every vector this embedder returns. */
  readonly dimensions: number;
  /**
   * One vector per input text, in input order. Every text must be non-empty.
   * Throws EmbeddingError on any failure; never returns a partial result.
   */
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbeddingErrorCode =
  "invalid_input" | "auth" | "rate_limited" | "timeout" | "unavailable" | "invalid_response";

/**
 * Same shape as ProviderCallError: `retryable` tells the caller whether trying
 * again could help (a timeout might, a bad key won't). The embedder itself
 * never retries - indexing and retrieval each decide their own policy.
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly code: EmbeddingErrorCode,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function assertNonEmptyTexts(texts: string[]): void {
  if (texts.some((text) => text.trim() === "")) {
    throw new EmbeddingError("cannot embed an empty text", "invalid_input", false);
  }
}
