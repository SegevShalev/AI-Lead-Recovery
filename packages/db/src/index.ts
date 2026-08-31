import mongoose from "mongoose";

export { mongoose };

/**
 * Each service owns its own Mongoose schemas (see docs/architecture/data-model.md).
 * This package only centralizes the connection lifecycle so every service
 * connects/disconnects the same way.
 */
export async function connectMongo(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
