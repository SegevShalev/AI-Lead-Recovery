import type { SuggestionRequest } from "@ai-lead-recovery/shared";
import {
  createLogger,
  emptyRetrieval,
  type Logger,
  type RetrievalInfo,
} from "@ai-lead-recovery/shared";
import { describe, expect, it } from "vitest";
import type { Retriever } from "./knowledge/retriever.js";
import type { ChunkHit } from "./knowledge/vectorStore.js";
import { MockSuggestionProvider } from "./providers/mock.js";
import type {
  GenerationInput,
  ProviderResponse,
  SuggestionProvider,
  TokenUsage,
} from "./providers/types.js";
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
    /** Reported on every call that returns, like a billed model. */
    private readonly usage?: TokenUsage,
  ) {}

  async generate(_input: GenerationInput): Promise<ProviderResponse> {
    this.callCount += 1;
    const index = Math.min(this.callCount, this.script.length) - 1;
    const step = this.script[index];
    if (!step) throw new Error(`ScriptedProvider has no step at index ${index}`);
    return { output: step(), ...(this.usage ? { usage: this.usage } : {}) };
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
      expect(result.promptVersion).toBe("hebrew-followup-v2");
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

  describe("retrieval", () => {
    const usedRetrieval: RetrievalInfo = {
      status: "used",
      sources: [{ documentId: "doc-brakes", version: 2, chunkId: "chunk-1", score: 0.61 }],
      contextVersion: "0123456789abcdef",
    };
    function countingRetriever(info: RetrievalInfo, chunks: ChunkHit[] = []) {
      const retriever = {
        calls: 0,
        retrieve: async () => {
          retriever.calls++;
          return { info, chunks };
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

    it("shows the retrieved chunks to the model, best match first", async () => {
      const seen: GenerationInput[] = [];
      const provider: SuggestionProvider = {
        name: "recording",
        generate: async (input) => {
          seen.push(input);
          return { output: { message: "היי דנה", reason: "ok" } };
        },
      };
      const generator = new SuggestionGenerator(
        provider,
        undefined,
        silentLogger,
        countingRetriever(usedRetrieval, [BRAKES_HIT, HOURS_HIT]),
      );

      await generator.generate(baseRequest);

      expect(seen[0]!.knowledge).toEqual([
        { type: "service", text: BRAKES_HIT.text },
        { type: "faq", text: HOURS_HIT.text },
      ]);
    });
  });

  describe("grounding check", () => {
    const brakesRetriever: Retriever = {
      retrieve: async () => ({ info: emptyRetrieval, chunks: [BRAKES_HIT] }),
    };
    const reply = (message: string) => () => ({ message, reason: "ok" });

    it("accepts a price that is in the retrieved knowledge", async () => {
      const provider = new ScriptedProvider("primary", [reply("רפידות קדמיות: 450 ₪ כולל עבודה")]);
      const generator = new SuggestionGenerator(provider, undefined, silentLogger, brakesRetriever);

      const result = await generator.generate(baseRequest);

      expect(result).toMatchObject({ status: "ok", message: "רפידות קדמיות: 450 ₪ כולל עבודה" });
      expect(provider.callCount).toBe(1);
    });

    it("retries an invented price, and returns the next grounded message", async () => {
      const provider = new ScriptedProvider("primary", [
        reply("רפידות קדמיות רק 400 ₪!"),
        reply("רפידות קדמיות: 450 ₪"),
      ]);
      const logger = recordingLogger();
      const generator = new SuggestionGenerator(provider, undefined, logger, brakesRetriever);

      const result = await generator.generate(baseRequest);

      expect(result).toMatchObject({ status: "ok", message: "רפידות קדמיות: 450 ₪" });
      expect(provider.callCount).toBe(2);
      // A count only - the invented number itself is generated content.
      expect(logger.lines).toContainEqual(
        expect.objectContaining({
          message: "suggestion failed grounding check",
          ungroundedNumbers: 1,
        }),
      );
      expect(JSON.stringify(logger.lines)).not.toContain("400");
    });

    it("degrades with invalid_output when every attempt invents a number", async () => {
      const provider = new ScriptedProvider("primary", [reply("רפידות רק 400 ₪!")]);
      const generator = new SuggestionGenerator(provider, undefined, silentLogger, brakesRetriever);

      const result = await generator.generate(baseRequest);

      expect(provider.callCount).toBe(3);
      expect(result).toEqual({ status: "degraded", errorCode: "invalid_output" });
    });

    it("traces every attempt: rejections, summed tokens, documents shown", async () => {
      const usage = { inputTokens: 100, outputTokens: 20 };
      const provider = new ScriptedProvider(
        "primary",
        [reply("רק 400 ₪!"), () => ({ message: 42 }), reply("רפידות: 450 ₪")],
        usage,
      );
      const generator = new SuggestionGenerator(provider, undefined, silentLogger, brakesRetriever);

      const { response, trace } = await generator.generateWithTrace(baseRequest);

      expect(response.status).toBe("ok");
      expect(trace).toEqual({
        attempts: 3,
        groundingRejections: 1,
        inputTokens: 300,
        outputTokens: 60,
        retrievalStatus: "empty",
        knowledgeChunks: 1,
        knowledgeDocumentIds: ["doc-brakes"],
      });
    });

    it("counts tokens of a billed call whose reply was unusable", async () => {
      const billedButBroken = new ProviderCallError("not JSON", "invalid_output", true, {
        inputTokens: 100,
        outputTokens: 5,
      });
      const provider = new ScriptedProvider("primary", [
        throwing(billedButBroken),
        reply("היי דנה"),
      ]);
      const generator = new SuggestionGenerator(provider, undefined, silentLogger, noKnowledge);

      const { trace } = await generator.generateWithTrace(baseRequest);

      expect(trace).toMatchObject({ attempts: 2, inputTokens: 100, outputTokens: 5 });
    });

    it("never lets the internal estimated value through as a price", async () => {
      // baseRequest.estimatedValue is 250, and no source mentions it.
      const provider = new ScriptedProvider("primary", [reply("העבודה תעלה 250 ₪")]);
      const generator = new SuggestionGenerator(provider, undefined, silentLogger, noKnowledge);

      expect(await generator.generate(baseRequest)).toEqual({
        status: "degraded",
        errorCode: "invalid_output",
      });
    });
  });
});

const BRAKES_HIT: ChunkHit = {
  chunkId: "chunk-1",
  businessId: "business-1",
  documentId: "doc-brakes",
  version: 2,
  type: "service",
  title: "החלפת רפידות בלמים",
  chunkIndex: 0,
  text: "החלפת רפידות בלמים\nהחלפת רפידות בלמים קדמיות: 450 ₪ כולל עבודה.",
  score: 0.61,
};
const HOURS_HIT: ChunkHit = {
  ...BRAKES_HIT,
  chunkId: "chunk-2",
  documentId: "doc-hours",
  type: "faq",
  title: "שעות פתיחה",
  text: "שעות פתיחה\nראשון עד חמישי 08:00-17:00.",
  score: 0.44,
};

function recordingLogger(): Logger & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const record = (message: string, fields?: object) => lines.push({ message, ...fields });
  return { lines, info: record, warn: record, error: record };
}
