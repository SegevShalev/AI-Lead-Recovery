import { afterAll, describe, expect, it } from "vitest";
import { connectMongo, disconnectMongo, mongoose } from "./index.js";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27018/ai-lead-recovery-test";

describe("connectMongo", () => {
  afterAll(async () => {
    await disconnectMongo();
  });

  it("connects to MongoDB", async () => {
    await connectMongo(MONGODB_URI);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
