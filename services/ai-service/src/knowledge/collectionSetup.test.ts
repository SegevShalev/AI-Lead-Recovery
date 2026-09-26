import type { Logger } from "@ai-lead-recovery/shared";
import { describe, expect, it } from "vitest";
import { ensureCollectionInBackground } from "./collectionSetup.js";
import { InMemoryVectorStore } from "./inMemoryVectorStore.js";
import { CollectionMismatchError, VectorStoreError } from "./vectorStore.js";

function recordingLogger() {
  const lines: { level: string; message: string; fields: object | undefined }[] = [];
  const logger: Logger = {
    info: (message, fields) => lines.push({ level: "info", message, fields }),
    warn: (message, fields) => lines.push({ level: "warn", message, fields }),
    error: (message, fields) => lines.push({ level: "error", message, fields }),
  };
  return { logger, lines };
}

/** A store whose ensureCollection throws the given errors, one per call, then succeeds. */
function storeFailingWith(...errors: Error[]) {
  const store = new InMemoryVectorStore();
  let calls = 0;
  store.ensureCollection = async () => {
    const error = errors[calls++];
    if (error) throw error;
  };
  return { store, calls: () => calls };
}

describe("ensureCollectionInBackground", () => {
  it("keeps retrying with backoff until the store is reachable", async () => {
    const { logger, lines } = recordingLogger();
    const { store, calls } = storeFailingWith(
      new VectorStoreError("qdrant unreachable"),
      new VectorStoreError("qdrant unreachable"),
    );

    await ensureCollectionInBackground(store, logger, { initialDelayMs: 1, maxDelayMs: 2 });

    expect(calls()).toBe(3);
    expect(lines.filter((line) => line.level === "warn").map((line) => line.fields)).toEqual([
      expect.objectContaining({ attempt: 1, retryInMs: 1 }),
      expect.objectContaining({ attempt: 2, retryInMs: 2 }),
    ]);
    expect(lines.at(-1)).toMatchObject({ level: "info", message: "knowledge collection ready" });
  });

  it("logs a collection made for another embedder as an error, and recovers once it is deleted", async () => {
    const { logger, lines } = recordingLogger();
    // Second attempt succeeds = someone deleted the collection in between.
    const { store } = storeFailingWith(new CollectionMismatchError("size=256, expected 1536"));

    await ensureCollectionInBackground(store, logger, { initialDelayMs: 1 });

    expect(lines[0]).toMatchObject({
      level: "error",
      message: "knowledge collection was made for another embedder",
    });
    expect(lines.at(-1)).toMatchObject({ level: "info", message: "knowledge collection ready" });
  });
});
