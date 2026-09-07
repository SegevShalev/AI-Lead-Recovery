import mongoose from "mongoose";

export { mongoose };

const DEFAULT_RETRIES = 10;
const DEFAULT_RETRY_DELAY_MS = 2000;
const CONNECT_TIMEOUT_MS = 3000;

export interface ConnectMongoOptions {
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Each service owns its own Mongoose schemas (see docs/architecture/data-model.md).
 * This package only centralizes the connection lifecycle so every service
 * connects/disconnects the same way.
 *
 * Retries with backoff: on `docker compose up -d && pnpm dev`, Mongo can
 * still be initializing (or the image still pulling) when a service starts.
 * Without a retry here, mongoose.connect() rejecting once would crash the
 * service outright instead of waiting the few extra seconds Mongo needs.
 */
export async function connectMongo(
  uri: string,
  { retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS }: ConnectMongoOptions = {},
): Promise<typeof mongoose> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await mongoose.connect(uri, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS });
    } catch (error) {
      if (attempt > retries) throw error;
      console.warn(
        `[db] MongoDB connection attempt ${attempt}/${retries} failed, retrying in ${retryDelayMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
