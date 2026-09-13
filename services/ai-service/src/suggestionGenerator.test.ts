import type { SuggestionRequest } from "@ai-lead-recovery/shared";
import { createLogger } from "@ai-lead-recovery/shared";
import { describe, expect, it } from "vitest";
import { MockSuggestionProvider } from "./providers/mock.js";
import type { GenerationInput, SuggestionProvider } from "./providers/types.js";
import { ProviderCallError } from "./providers/types.js";
import { SuggestionGenerator } from "./suggestionGenerator.js";

const silentLogger = createLogger("ai-service-test");

const baseRequest: SuggestionRequest = {
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

/** Test double that scripts one throw/return per call and counts how many times it ran. */
class ScriptedProvider implements SuggestionProvider {
  callCount = 0;
  constructor(
    readonly name: string,
    private readonly script: (() => unknown)[],
  ) {}

  async generate(_input: GenerationInput): Promise<unknown> {
    this.callCount += 1;
    const index = Math.min(this.callCount, this.script.length) - 1;
    const step = this.script[index];
    if (!step) throw new Error(`ScriptedProvider has no step at index ${index}`);
    return step();
  }
}

function throwing(error: ProviderCallError): () => never {
  return () => {
    throw error;
  };
}

describe("SuggestionGenerator", () => {
  it("returns ok on a successful mock generation", async () => {
    const generator = new SuggestionGenerator(
      new MockSuggestionProvider(),
      undefined,
      silentLogger,
    );
    const result = await generator.generate(baseRequest);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model).toBe("mock");
      expect(result.language).toBe("he");
      expect(result.promptVersion).toBe("hebrew-followup-v1");
      expect(result.message).toContain(baseRequest.customer.displayName);
    }
  });

  it("degrades after retrying malformed model output 3 times", async () => {
    const provider = new ScriptedProvider("flaky", [
      () => ({ message: 123 }),
      () => ({}),
      () => null,
    ]);
    const generator = new SuggestionGenerator(provider, undefined, silentLogger);

    const result = await generator.generate(baseRequest);

    expect(provider.callCount).toBe(3);
    expect(result).toEqual({ status: "degraded", errorCode: "invalid_output" });
  });

  it("degrades after retrying a retryable provider failure 3 times (no fallback configured)", async () => {
    const provider = new ScriptedProvider("flaky", [
      throwing(new ProviderCallError("boom", "provider_error", true)),
      throwing(new ProviderCallError("boom", "provider_error", true)),
      throwing(new ProviderCallError("boom", "provider_error", true)),
    ]);
    const generator = new SuggestionGenerator(provider, undefined, silentLogger);

    const result = await generator.generate(baseRequest);

    expect(provider.callCount).toBe(3);
    expect(result).toEqual({ status: "degraded", errorCode: "provider_error" });
  });

  it("falls back to the fallback model when the primary exhausts retries, and reports its name", async () => {
    const primary = new ScriptedProvider("primary", [
      throwing(new ProviderCallError("boom", "provider_error", true)),
      throwing(new ProviderCallError("boom", "provider_error", true)),
      throwing(new ProviderCallError("boom", "provider_error", true)),
    ]);
    const fallback = new MockSuggestionProvider({ name: "fallback-mock" });
    const generator = new SuggestionGenerator(primary, fallback, silentLogger);

    const result = await generator.generate(baseRequest);

    expect(primary.callCount).toBe(3);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model).toBe("fallback-mock");
    }
  });

  it("makes only one attempt on the fallback, then degrades with the fallback's error code", async () => {
    const primary = new ScriptedProvider("primary", [
      throwing(new ProviderCallError("boom", "provider_error", true)),
      throwing(new ProviderCallError("boom", "provider_error", true)),
      throwing(new ProviderCallError("boom", "provider_error", true)),
    ]);
    const fallback = new ScriptedProvider("fallback", [
      throwing(new ProviderCallError("auth failed", "provider_unavailable", false)),
    ]);
    const generator = new SuggestionGenerator(primary, fallback, silentLogger);

    const result = await generator.generate(baseRequest);

    expect(primary.callCount).toBe(3);
    expect(fallback.callCount).toBe(1);
    expect(result).toEqual({ status: "degraded", errorCode: "provider_unavailable" });
  });

  it("does not retry a non-retryable primary failure before moving to the fallback", async () => {
    const primary = new ScriptedProvider("primary", [
      throwing(new ProviderCallError("bad auth", "provider_unavailable", false)),
    ]);
    const fallback = new MockSuggestionProvider({ name: "fallback-mock" });
    const generator = new SuggestionGenerator(primary, fallback, silentLogger);

    const result = await generator.generate(baseRequest);

    expect(primary.callCount).toBe(1);
    expect(result.status).toBe("ok");
  });
});
