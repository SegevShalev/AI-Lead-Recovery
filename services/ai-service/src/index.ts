import { loadEnv } from "@ai-lead-recovery/config";
import { createLogger } from "@ai-lead-recovery/shared";
import { createApp } from "./app.js";
import { ensureCollectionInBackground } from "./knowledge/collectionSetup.js";
import { createEmbedderFromEnv } from "./knowledge/embedderFactory.js";
import { KnowledgeIndexer } from "./knowledge/knowledgeIndexer.js";
import { knowledgeCollectionName, QdrantVectorStore } from "./knowledge/qdrantVectorStore.js";
import { createProvidersFromEnv } from "./providerFactory.js";
import { SuggestionGenerator } from "./suggestionGenerator.js";

const env = loadEnv();
const port = env.PORT ?? 3001;
const logger = createLogger("ai-service");

const { primary, fallback } = createProvidersFromEnv(env);
const generator = new SuggestionGenerator(primary, fallback, logger);

const embedder = createEmbedderFromEnv(env);
const collection = knowledgeCollectionName(embedder.model);
const vectorStore = new QdrantVectorStore({
  url: env.QDRANT_URL,
  collection,
  dimensions: embedder.dimensions,
  embeddingModel: embedder.model,
});
const indexer = new KnowledgeIndexer(embedder, vectorStore, logger);
// Not awaited: the service serves suggestions even while Qdrant is down.
void ensureCollectionInBackground(vectorStore, logger);

const app = createApp(generator, indexer, logger);
app.listen(port, () => {
  console.log(
    `[ai-service] listening on port ${port} (env=${env.NODE_ENV}, provider=${env.AI_PROVIDER}, fallback=${env.AI_FALLBACK_PROVIDER ?? "none"}, embedder=${embedder.model}, collection=${collection})`,
  );
});
