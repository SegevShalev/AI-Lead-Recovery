import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import { createApp } from "./app.js";

const MONGODB_URI =
  (process.env.MONGODB_URI ?? "mongodb://localhost:27017/ai-lead-recovery-test") +
  "-recovery-worker-app";

describe("recovery-worker app", () => {
  describe("GET /health", () => {
    it("is degraded when mongo and redis are not connected", async () => {
      const app = createApp({ isRedisConnected: () => false, lastEventProcessedAt: () => null });
      const response = await request(app).get("/health");
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: "degraded",
        service: "recovery-worker",
        mongoConnected: false,
        redisConnected: false,
        lastEventProcessedAt: null,
      });
    });

    describe("once mongo is connected", () => {
      beforeAll(async () => {
        await connectMongo(MONGODB_URI);
      });

      afterAll(async () => {
        await disconnectMongo();
      });

      it("is ok, and reports the last-processed time", async () => {
        const processedAt = new Date();
        const app = createApp({
          isRedisConnected: () => true,
          lastEventProcessedAt: () => processedAt,
        });
        const response = await request(app).get("/health");
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          status: "ok",
          mongoConnected: true,
          redisConnected: true,
          lastEventProcessedAt: processedAt.toISOString(),
        });
      });
    });
  });
});
