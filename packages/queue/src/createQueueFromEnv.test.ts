import { describe, expect, it } from "vitest";
import { createQueueFromEnv } from "./createQueueFromEnv.js";

describe("createQueueFromEnv", () => {
  it("returns a redis-backed queue for QUEUE_PROVIDER=local", () => {
    const queue = createQueueFromEnv(
      { QUEUE_PROVIDER: "local", REDIS_URL: "redis://localhost:6379" },
      "test-queue",
    );
    expect(typeof queue.publish).toBe("function");
    expect(typeof queue.consume).toBe("function");
  });

  it("returns an sqs-backed queue for QUEUE_PROVIDER=sqs when config is present", () => {
    const queue = createQueueFromEnv(
      {
        QUEUE_PROVIDER: "sqs",
        REDIS_URL: "redis://localhost:6379",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test-queue",
        AWS_REGION: "us-east-1",
      },
      "test-queue",
    );
    expect(typeof queue.publish).toBe("function");
    expect(typeof queue.consume).toBe("function");
  });

  it("throws when QUEUE_PROVIDER=sqs but SQS_QUEUE_URL/AWS_REGION are missing", () => {
    expect(() =>
      createQueueFromEnv({ QUEUE_PROVIDER: "sqs", REDIS_URL: "redis://localhost:6379" }, "test-queue"),
    ).toThrow(/SQS_QUEUE_URL and AWS_REGION/);
  });
});
