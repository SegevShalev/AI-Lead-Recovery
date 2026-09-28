import { describe, expect, it } from "vitest";
import type { IndexDocumentRequest } from "@ai-lead-recovery/shared";
import { createHttpKnowledgeIndexClient } from "./knowledgeIndexClient.js";

const indexRequest: IndexDocumentRequest = {
  businessId: "business-1",
  documentId: "doc-1",
  version: 2,
  type: "service",
  title: "בלמים",
  content: "החלפת רפידות: 450 ₪",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpKnowledgeIndexClient", () => {
  it("posts the request and returns the parsed response", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const client = createHttpKnowledgeIndexClient("http://ai.local", async (url, init) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) };
      return jsonResponse(200, { status: "ok", chunkCount: 1, embeddingModel: "mock" });
    });

    const result = await client.indexDocument(indexRequest);

    expect(result).toEqual({
      ok: true,
      data: { status: "ok", chunkCount: 1, embeddingModel: "mock" },
    });
    expect(seen).toEqual({ url: "http://ai.local/internal/knowledge/index", body: indexRequest });
  });

  it("maps a non-2xx response to unreachable", async () => {
    const client = createHttpKnowledgeIndexClient("http://ai.local", async () =>
      jsonResponse(404, { error: "not_found" }),
    );
    expect(await client.indexDocument(indexRequest)).toEqual({
      ok: false,
      errorCode: "unreachable",
    });
  });

  it("maps a network error to unreachable instead of throwing", async () => {
    const client = createHttpKnowledgeIndexClient("http://ai.local", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await client.indexDocument(indexRequest)).toEqual({
      ok: false,
      errorCode: "unreachable",
    });
  });

  it("maps a 2xx body that breaks the contract to invalid_response", async () => {
    const client = createHttpKnowledgeIndexClient("http://ai.local", async () =>
      jsonResponse(200, { status: "ok" }),
    );
    expect(await client.indexDocument(indexRequest)).toEqual({
      ok: false,
      errorCode: "invalid_response",
    });
  });

  it("deletes via the scoped URL and treats 204 as success", async () => {
    let seen: { url: string; method: string | undefined } | undefined;
    const client = createHttpKnowledgeIndexClient("http://ai.local", async (url, init) => {
      seen = { url: String(url), method: init?.method };
      return new Response(null, { status: 204 });
    });

    expect(await client.deleteDocument("business-1", "doc-1")).toEqual({ ok: true });
    expect(seen).toEqual({
      url: "http://ai.local/internal/knowledge/business-1/doc-1",
      method: "DELETE",
    });
  });

  it("reports a failed delete as unreachable", async () => {
    const client = createHttpKnowledgeIndexClient("http://ai.local", async () =>
      jsonResponse(500, {}),
    );
    expect(await client.deleteDocument("business-1", "doc-1")).toEqual({
      ok: false,
      errorCode: "unreachable",
    });
  });
});
