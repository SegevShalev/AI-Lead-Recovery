import { createClient, type RedisClientType } from "redis";
import type { EventEnvelope } from "@ai-lead-recovery/shared";

export interface Queue {
  publish<T extends EventEnvelope>(event: T): Promise<void>;
  /** Starts a long-running consume loop. Resolves once `stop()` is called. */
  consume(handler: (event: EventEnvelope) => Promise<void>): Promise<void>;
  stop(): void;
  close(): Promise<void>;
}

const BLOCK_TIMEOUT_SECONDS = 5;

/**
 * Redis-list-backed queue: RPUSH (producer) + BLPOP (consumer) gives FIFO
 * delivery across separate processes, which is what "local queue adapter"
 * needs to actually work for api -> recovery-worker. No retries/DLQ here —
 * those are Phase 2 (see docs/development/roadmap.md); a failed handler is
 * logged and dropped rather than requeued.
 */
export function createRedisListQueue(redisUrl: string, queueName: string): Queue {
  const publisher: RedisClientType = createClient({ url: redisUrl });
  const consumer: RedisClientType = createClient({ url: redisUrl });
  let stopped = false;

  async function ensureConnected(client: RedisClientType): Promise<void> {
    if (!client.isOpen) {
      await client.connect();
    }
  }

  return {
    async publish<T extends EventEnvelope>(event: T) {
      await ensureConnected(publisher);
      await publisher.rPush(queueName, JSON.stringify(event));
    },

    async consume(handler) {
      await ensureConnected(consumer);
      stopped = false;
      while (!stopped) {
        const result = await consumer.blPop(queueName, BLOCK_TIMEOUT_SECONDS);
        if (!result) continue;

        const event = JSON.parse(result.element) as EventEnvelope;
        try {
          await handler(event);
        } catch (error) {
          console.error(`[queue] handler failed for event ${event.eventId}`, error);
        }
      }
    },

    stop() {
      stopped = true;
    },

    async close() {
      if (publisher.isOpen) await publisher.quit();
      if (consumer.isOpen) await consumer.quit();
    },
  };
}
