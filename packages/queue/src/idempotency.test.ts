import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";
import { markProcessed } from "./idempotency.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("markProcessed", () => {
  let redis: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redis = createClient({ url: REDIS_URL });
    await redis.connect();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("returns true on first delivery and false on duplicates", async () => {
    const eventId = crypto.randomUUID();
    expect(await markProcessed(redis, eventId, 60)).toBe(true);
    expect(await markProcessed(redis, eventId, 60)).toBe(false);
  });
});
