import { describe, expect, it } from "vitest";
import { EmbeddingError } from "./embedder.js";
import { createEmbedderFromEnv } from "./embedderFactory.js";
import { MockEmbedder } from "./mockEmbedder.js";
import { OpenAIEmbedder } from "./openaiEmbedder.js";
import { cosineSimilarity } from "./similarity.js";

const BRAKES_CHUNK = "החלפת רפידות בלמים\nהחלפת רפידות בלמים קדמיות: 450 ₪ כולל עבודה.";
const HOURS_CHUNK = "שעות פתיחה\nראשון עד חמישי 08:00-17:00. שישי ושבת סגור.";
const BRAKES_QUESTION = "כמה עולה להחליף רפידות בלמים?";

describe("MockEmbedder", () => {
  const embedder = new MockEmbedder();

  it("returns one vector per text, with the declared dimensions", async () => {
    const vectors = await embedder.embed([BRAKES_CHUNK, HOURS_CHUNK]);
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) expect(vector).toHaveLength(embedder.dimensions);
  });

  it("is deterministic: same text, same vector", async () => {
    const [first] = await embedder.embed([BRAKES_CHUNK]);
    const [second] = await new MockEmbedder().embed([BRAKES_CHUNK]);
    expect(second).toEqual(first);
  });

  it("returns unit-length vectors", async () => {
    const vectors = await embedder.embed([BRAKES_CHUNK, "!!!"]);
    for (const vector of vectors) {
      const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      expect(length).toBeCloseTo(1, 10);
    }
  });

  it("scores a related question higher than an unrelated chunk", async () => {
    const [question, brakes, hours] = await embedder.embed([
      BRAKES_QUESTION,
      BRAKES_CHUNK,
      HOURS_CHUNK,
    ]);
    expect(cosineSimilarity(question!, brakes!)).toBeGreaterThan(
      cosineSimilarity(question!, hours!) + 0.2,
    );
  });

  it("matches a word with a Hebrew prefix letter to the bare word", async () => {
    const [bare, prefixed, unrelated] = await embedder.embed(["בלמים", "הבלמים", "מזגן"]);
    expect(cosineSimilarity(bare!, prefixed!)).toBeGreaterThan(0.5);
    expect(cosineSimilarity(bare!, unrelated!)).toBeLessThan(0.3);
  });

  it("rejects empty text with a non-retryable invalid_input error", async () => {
    const error = await embedder.embed([BRAKES_CHUNK, "  "]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error).toMatchObject({ code: "invalid_input", retryable: false });
  });
});

describe("createEmbedderFromEnv", () => {
  it("builds the mock by default and the OpenAI adapter when asked", () => {
    expect(createEmbedderFromEnv({ EMBEDDING_PROVIDER: "mock" })).toBeInstanceOf(MockEmbedder);
    expect(
      createEmbedderFromEnv({ EMBEDDING_PROVIDER: "openai", EMBEDDING_API_KEY: "sk-test" }),
    ).toBeInstanceOf(OpenAIEmbedder);
  });

  it("refuses openai without a key", () => {
    expect(() => createEmbedderFromEnv({ EMBEDDING_PROVIDER: "openai" })).toThrow(
      /EMBEDDING_API_KEY/,
    );
  });
});
