import { z } from "zod";
import { assertNonEmptyTexts, type Embedder, EmbeddingError } from "./embedder.js";

export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIMENSIONS = 1536;
/**
 * services/api waits at most 5 s for a whole index call (chunk + embed +
 * store), so one embedding request has to give up well before that.
 */
const DEFAULT_TIMEOUT_MS = 4_000;

// Only the fields we use. Anything else in the response is ignored.
const embeddingsResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()),
    }),
  ),
});

export interface OpenAIEmbedderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * `POST /v1/embeddings` with plain fetch - it is a single endpoint, and
 * without an SDK the raw request/response stays visible (plan Stage 3).
 * Error messages carry the HTTP status only, never the input texts or the
 * response body.
 */
export class OpenAIEmbedder implements Embedder {
  readonly model = OPENAI_EMBEDDING_MODEL;
  readonly dimensions = OPENAI_EMBEDDING_DIMENSIONS;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIEmbedderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    assertNonEmptyTexts(texts);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: this.model, input: texts, encoding_format: "float" }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new EmbeddingError(
          `embedding request timed out after ${this.timeoutMs}ms`,
          "timeout",
          true,
        );
      }
      throw new EmbeddingError("embedding provider unreachable", "unavailable", true);
    }

    if (!response.ok) throw errorForStatus(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EmbeddingError("embedding response was not JSON", "invalid_response", false);
    }
    const parsed = embeddingsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new EmbeddingError("embedding response failed validation", "invalid_response", false);
    }

    // The API returns an `index` per item; don't assume the array is in input order.
    const byIndex = [...parsed.data.data].sort((a, b) => a.index - b.index);
    const complete =
      byIndex.length === texts.length &&
      byIndex.every((item, i) => item.index === i && item.embedding.length === this.dimensions);
    if (!complete) {
      throw new EmbeddingError(
        "embedding response has missing items or wrong dimensions",
        "invalid_response",
        false,
      );
    }
    return byIndex.map((item) => item.embedding);
  }
}

function errorForStatus(status: number): EmbeddingError {
  const message = `embedding provider returned HTTP ${status}`;
  if (status === 401 || status === 403) return new EmbeddingError(message, "auth", false);
  if (status === 429) return new EmbeddingError(message, "rate_limited", true);
  if (status >= 500) return new EmbeddingError(message, "unavailable", true);
  // Other 4xx: our request was wrong (e.g. input too long) - retrying won't fix it.
  return new EmbeddingError(message, "invalid_input", false);
}
