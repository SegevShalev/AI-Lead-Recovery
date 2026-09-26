import type { Logger } from "@ai-lead-recovery/shared";
import { describe, expect, it } from "vitest";
import { ensureCollectionInBackground } from "./collectionSetup.js";
import { InMemoryVectorStore } from "./inMemoryVectorStore.js";
import { VectorStoreError } from "./vectorStore.js";

describe("ensureCollectionInBackground", () => {
  it("keeps retrying until the store is reachable", async () => {
    const warnings: unknown[] = [];
    const logger: Logger = { info: () => {}, warn: (_m, f) => warnings.push(f), error: () => {} };
    const store = new InMemoryVectorStore();
    let calls = 0;
    store.ensureCollection = async () => {
      calls++;
      if (calls < 3) throw new VectorStoreError("qdrant unreachable");
    };

    await ensureCollectionInBackground(store, logger, { initialDelayMs: 1, maxDelayMs: 2 });

    expect(calls).toBe(3);
    expect(warnings).toEqual([
      expect.objectContaining({ attempt: 1, retryInMs: 1 }),
      expect.objectContaining({ attempt: 2, retryInMs: 2 }),
    ]);
  });
});
