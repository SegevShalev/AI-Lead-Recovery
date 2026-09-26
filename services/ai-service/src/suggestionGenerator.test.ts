import type { SuggestionRequest } from "@ai-lead-recovery/shared";
import { createLogger, emptyRetrieval, type RetrievalInfo } from "@ai-lead-recovery/shared";
import { describe, expect, it } from "vitest";
import type { Retriever } from "./knowledge/retriever.js";
import { MockSuggestionProvider } from "./providers/mock.js";
import type { GenerationInput, SuggestionProvider } from "./providers/types.js";
import { ProviderCallError } from "./providers/types.js";
import { SuggestionGenerator } from "./suggestionGenerator.js";

const silentLogger = createLogger("ai-service-test");
/** For tests about generation itself: the business has no knowledge. */
const noKnowledge: Retriever = { retrieve: async () => ({ info: emptyRetrieval, chunks: [] }) };

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
      noKnowledge,
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
    const generator = new SuggestionGenerator(provider, undefined, silentLogger, noKnowledge);

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
    const generator = new SuggestionGenerator(provider, undefined, silentLogger, noKnowledge);

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
    const generator = new SuggestionGenerator(primary, fallback, silentLogger, noKnowledge);

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
    const generator = new SuggestionGenerator(primary, fallback, silentLogger, noKnowledge);

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
    const generator = new SuggestionGenerator(primary, fallback, silentLogger, noKnowledge);

    const result = await generator.generate(baseRequest);

    expect(primary.callCount).toBe(1);
    expect(result.status).toBe("ok");
  });

  describe("retrieval (Stage 6: reported, not yet used by the prompt)", () => {
    const usedRetrieval: RetrievalInfo = {
      status: "used",
      sources: [{ documentId: "doc-brakes", version: 2, chunkId: "chunk-1", score: 0.61 }],
      contextVersion: "0123456789abcdef",
    };
    function countingRetriever(info: RetrievalInfo) {
      const retriever = {
        calls: 0,
        retrieve: async () => {
          retriever.calls++;
          return { info, chunks: [] };
        },
      };
      return retriever;
    }

    it("returns the retrieval info with the suggestion", async () => {
      const retriever = countingRetriever(usedRetrieval);
      const generator = new SuggestionGenerator(
        new MockSuggestionProvider(),
        undefined,
        silentLogger,
        retriever,
      );

      const result = await generator.generate(baseRequest);

      expect(result).toMatchObject({ status: "ok", retrieval: usedRetrieval });
    });

    it("still returns an ok suggestion when retrieval failed (degrade rule)", async () => {
      const failed: RetrievalInfo = { status: "failed", sources: [], contextVersion: "none" };
      const generator = new SuggestionGenerator(
        new MockSuggestionProvider(),
        undefined,
        silentLogger,
        countingRetriever(failed),
      );

      const result = await generator.generate(baseRequest);

      expect(result).toMatchObject({ status: "ok", retrieval: failed });
    });

    it("retrieves once per request, not once per retry attempt", async () => {
      const provider = new ScriptedProvider("primary", [
        () => ({ message: 42 }),
        () => ({ message: 42 }),
        () => ({ message: "היי דנה", reason: "ok" }),
      ]);
      const retriever = countingRetriever(usedRetrieval);
      const generator = new SuggestionGenerator(provider, undefined, silentLogger, retriever);

      await generator.generate(baseRequest);

      expect(provider.callCount).toBe(3);
      expect(retriever.calls).toBe(1);
    });
  });
});
