import { describe, expect, it } from "vitest";
import { describeStartup } from "./worker.js";

describe("describeStartup", () => {
  it("includes the queue provider", () => {
    const message = describeStartup({
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
      REDIS_URL: "redis://localhost:6379",
      QUEUE_PROVIDER: "local",
      AI_PROVIDER: "mock",
      UNANSWERED_THRESHOLD_MINUTES: 60,
    });
    expect(message).toContain("queueProvider=local");
  });
});
