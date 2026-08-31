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

  it("throws when required values are missing", () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment configuration/);
  });
});
