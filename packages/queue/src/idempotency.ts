/**
 * Narrow structural shape instead of importing `redis`'s `RedisClientType` —
 * that type is parameterized over the client's module map, and pinning
 * callers to one specific instantiation causes needless friction wherever
 * a differently-configured client is passed in. Any real client's `get`/`set`
 * satisfies this. Shared with services/api's dashboard cache (`NX` is
 * optional since only the idempotency check needs it).
 */
export interface RedisStringClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number; NX?: true }): Promise<string | null>;
}

/**
 * Records that `eventId` has been processed. Returns true the first time it's
 * called for a given eventId, false on any duplicate delivery — consumers
 * must tolerate duplicates (docs/architecture/service-boundaries.md).
 */
export async function markProcessed(
  redis: RedisStringClient,
  eventId: string,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redis.set(`processed:${eventId}`, "1", {
    NX: true,
    EX: ttlSeconds,
  });
  return result === "OK";
}
