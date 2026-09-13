import { describe, expect, it } from "vitest";
import type { SuggestionRequest } from "@ai-lead-recovery/shared";
import { createHttpSuggestionClient } from "./aiServiceClient.js";

const request: SuggestionRequest = {
  recoveryCaseId: "case-1",
  businessId: "business-1",
  caseType: "unanswered",
  reason: "no reply within 60 minutes",
  estimatedValue: 500,
  customer: { displayName: "דני", phone: "+972501234567" },
  conversationContext: [{ direction: "inbound", text: "hi", occurredAt: new Date().toISOString() }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpSuggestionClient", () => {
  it("returns the parsed ok result on a valid response", async () => {
    const okBody = {
      status: "ok",
      message: "היי, רק בודק איתך לגבי ההצעה",
      language: "he",
      reason: "quote sent, no reply",
      model: "mock",
      promptVersion: "hebrew-followup-v1",
      generatedAt: new Date().toISOString(),
    };
    const client = createHttpSuggestionClient("http://ai-service.local", async () =>
      jsonResponse(200, okBody),
    );

    const result = await client.requestSuggestion(request);
    expect(result).toEqual({ ok: true, data: okBody });
  });

  it("passes through a well-formed degraded response", async () => {
    const degradedBody = { status: "degraded", errorCode: "provider_error" };
    const client = createHttpSuggestionClient("http://ai-service.local", async () =>
      jsonResponse(200, degradedBody),
    );

    const result = await client.requestSuggestion(request);
    expect(result).toEqual({ ok: true, data: degradedBody });
  });

  it("reports unreachable on a network failure", async () => {
    const client = createHttpSuggestionClient("http://ai-service.local", async () => {
      throw new Error("ECONNREFUSED");
    });

    const result = await client.requestSuggestion(request);
    expect(result).toEqual({ ok: false, errorCode: "unreachable" });
  });

  it("reports unreachable on a non-2xx response", async () => {
    const client = createHttpSuggestionClient("http://ai-service.local", async () =>
      jsonResponse(500, { error: "internal" }),
    );

    const result = await client.requestSuggestion(request);
    expect(result).toEqual({ ok: false, errorCode: "unreachable" });
  });

  it("reports invalid_response when the body doesn't match the contract", async () => {
    const client = createHttpSuggestionClient("http://ai-service.local", async () =>
      jsonResponse(200, { status: "ok", message: "missing required fields" }),
    );

    const result = await client.requestSuggestion(request);
    expect(result).toEqual({ ok: false, errorCode: "invalid_response" });
  });

  it("reports invalid_response when the body isn't JSON", async () => {
    const client = createHttpSuggestionClient(
      "http://ai-service.local",
      async () => new Response("not json", { status: 200 }),
    );

    const result = await client.requestSuggestion(request);
    expect(result).toEqual({ ok: false, errorCode: "invalid_response" });
  });
});
