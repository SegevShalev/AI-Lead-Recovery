/**
 * `pnpm --filter @ai-lead-recovery/ai-service index:fixtures`
 *
 * Indexes fixtures/knowledge/garages.json into the real Qdrant through the
 * same KnowledgeIndexer the index endpoint uses, so the dashboard
 * (http://localhost:6333/dashboard) shows real data without running
 * services/api or Mongo. Idempotent: re-running replaces the same points.
 *
 * Fixture garages get their own businessIds (`fixture-north`, …), so this
 * never touches documents indexed through the API.
 */
import { loadEnv } from "@ai-lead-recovery/config";
import { createLogger } from "@ai-lead-recovery/shared";
import { fixtureIndexRequests, loadKnowledgeFixtures } from "../eval/fixtures.js";
import { createEmbedderFromEnv } from "../knowledge/embedderFactory.js";
import { KnowledgeIndexer } from "../knowledge/knowledgeIndexer.js";
import { KNOWLEDGE_COLLECTION, QdrantVectorStore } from "../knowledge/qdrantVectorStore.js";

const env = loadEnv();
const embedder = createEmbedderFromEnv(env);
const store = new QdrantVectorStore({
  url: env.QDRANT_URL,
  collection: KNOWLEDGE_COLLECTION,
  dimensions: embedder.dimensions,
  embeddingModel: embedder.model,
});
const indexer = new KnowledgeIndexer(embedder, store, createLogger("ai-service"));

try {
  // Once, not in the background like the service: a script should fail
  // fast, e.g. with the "delete the collection" message after an embedder switch.
  await store.ensureCollection();

  const chunksPerBusiness = new Map<string, number>();
  for (const request of fixtureIndexRequests(loadKnowledgeFixtures().garages)) {
    const { chunkCount } = await indexer.index(request);
    chunksPerBusiness.set(
      request.businessId,
      (chunksPerBusiness.get(request.businessId) ?? 0) + chunkCount,
    );
  }

  console.log(`\nIndexed into ${KNOWLEDGE_COLLECTION} with ${embedder.model}:`);
  for (const [businessId, chunks] of chunksPerBusiness)
    console.log(`  ${businessId}: ${chunks} chunks`);
} catch (error) {
  console.error(
    `\nindex:fixtures failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
