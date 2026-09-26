import { loadEnv } from "@ai-lead-recovery/config";
import { describe, expect, it } from "vitest";
import { describeStartup } from "./worker.js";

describe("describeStartup", () => {
  it("includes the queue provider", () => {
    // loadEnv fills defaults, so new env vars don't break this fixture.
    const message = describeStartup(
      loadEnv({
        NODE_ENV: "test",
        MONGODB_URI: "mongodb://localhost:27017/ai-lead-recovery",
        REDIS_URL: "redis://localhost:6379",
        QUEUE_PROVIDER: "local",
      }),
    );
    expect(message).toContain("queueProvider=local");
  });
});
