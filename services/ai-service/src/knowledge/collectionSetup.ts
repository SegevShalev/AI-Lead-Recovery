import type { Logger } from "@ai-lead-recovery/shared";
import { CollectionMismatchError, type VectorStore } from "./vectorStore.js";

export interface CollectionSetupOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Creates the collection without blocking startup. Suggestions worked before
 * Qdrant existed and must keep working without it (degrade rule): until this
 * succeeds, indexing answers 503 (→ "pending" in the API) and retrieval
 * reports "failed". Retries with backoff until it succeeds, logging each
 * failure.
 *
 * Resolves once the collection is ready (tests await it; index.ts doesn't).
 */
export async function ensureCollectionInBackground(
  store: VectorStore,
  logger: Logger,
  options: CollectionSetupOptions = {},
): Promise<void> {
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  let delayMs = options.initialDelayMs ?? 1_000;

  for (let attempt = 1; ; attempt++) {
    try {
      await store.ensureCollection();
      logger.info("knowledge collection ready", { attempt });
      return;
    } catch (error) {
      const fields = {
        attempt,
        retryInMs: delayMs,
        error: error instanceof Error ? error.message : "unknown error",
      };
      // A mismatch won't fix itself (EMBEDDING_PROVIDER was switched), so it is
      // an error, not a warning. Still retried: once someone deletes the
      // collection, the next attempt recreates it at the right size.
      if (error instanceof CollectionMismatchError) {
        logger.error("knowledge collection was made for another embedder", fields);
      } else {
        logger.warn("knowledge collection not ready, retrying", fields);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
}
