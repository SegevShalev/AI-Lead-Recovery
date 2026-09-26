import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("parses a valid environment", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
      REDIS_URL: "redis://localhost:6379",
      QUEUE_PROVIDER: "local",
      AI_PROVIDER: "mock",
    });
    expect(env.MONGODB_URI).toBe("mongodb://localhost:27017/ai-lead-recovery");
    expect(env.QUEUE_PROVIDER).toBe("local");
  });

  it("defaults QDRANT_URL to the docker-compose Qdrant", () => {
    const env = loadEnv({
      MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
      REDIS_URL: "redis://localhost:6379",
    });
    expect(env.QDRANT_URL).toBe("http://localhost:6333");
  });

  it("accepts a QDRANT_URL override and rejects a non-URL", () => {
    const base = {
      MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
      REDIS_URL: "redis://localhost:6379",
    };
    expect(loadEnv({ ...base, QDRANT_URL: "http://qdrant:6333" }).QDRANT_URL).toBe(
      "http://qdrant:6333",
    );
    expect(() => loadEnv({ ...base, QDRANT_URL: "not a url" })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("defaults to the mock embedder, which needs no key", () => {
    const env = loadEnv({
      MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
      REDIS_URL: "redis://localhost:6379",
    });
    expect(env.EMBEDDING_PROVIDER).toBe("mock");
  });

  it("requires EMBEDDING_API_KEY when EMBEDDING_PROVIDER=openai", () => {
    const base = {
      MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
      REDIS_URL: "redis://localhost:6379",
      EMBEDDING_PROVIDER: "openai",
    };
    // An empty value (as copied from .env.example) counts as missing.
    expect(() => loadEnv({ ...base, EMBEDDING_API_KEY: "" })).toThrow(/EMBEDDING_API_KEY/);
    expect(loadEnv({ ...base, EMBEDDING_API_KEY: "sk-test" }).EMBEDDING_PROVIDER).toBe("openai");
  });

  it("throws when required values are missing", () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment configuration/);
  });
});
