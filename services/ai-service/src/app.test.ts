import { createLogger } from "@ai-lead-recovery/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MockSuggestionProvider } from "./providers/mock.js";
import { SuggestionGenerator } from "./suggestionGenerator.js";

const silentLogger = createLogger("ai-service-test");
const validRequestBody = {
  recoveryCaseId: "case-1",
  businessId: "business-1",
  caseType: "unanswered",
  reason: "No reply after 60 minutes",
  estimatedValue: 250,
  customer: { displayName: "דנה", phone: "+972500000000" },
  conversationContext: [
    { direction: "outbound", text: "היי, מתי נוח לך?", occurredAt: "2026-09-01T10:00:00.000Z" },
  ],
};

function buildApp(
  generator = new SuggestionGenerator(new MockSuggestionProvider(), undefined, silentLogger),
) {
  return createApp(generator);
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await request(buildApp()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "ai-service" });
  });
});

describe("POST /internal/suggestions", () => {
  it("returns an ok suggestion for a valid request", async () => {
    const response = await request(buildApp()).post("/internal/suggestions").send(validRequestBody);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.language).toBe("he");
    expect(response.body.model).toBe("mock");
    expect(response.body.promptVersion).toBe("hebrew-followup-v1");
  });

  it("returns a degraded body instead of a 500 when the provider fails", async () => {
    const generator = new SuggestionGenerator(
      new MockSuggestionProvider({ failureMode: "provider_unavailable" }),
      undefined,
      silentLogger,
    );
    const response = await request(buildApp(generator))
      .post("/internal/suggestions")
      .send(validRequestBody);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "degraded", errorCode: "provider_unavailable" });
  });

  it("rejects a malformed request with 400", async () => {
    const response = await request(buildApp())
      .post("/internal/suggestions")
      .send({ ...validRequestBody, caseType: "not_a_real_case_type" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });
});
