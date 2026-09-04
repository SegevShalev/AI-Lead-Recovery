import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import type { EventEnvelope } from "@ai-lead-recovery/shared";
import type { Queue } from "./redisQueue.js";

/** Long-poll wait, mirrors BLOCK_TIMEOUT_SECONDS in redisQueue.ts. */
const WAIT_TIME_SECONDS = 5;

/** SQS allows up to 10 per ReceiveMessage call; batch to cut round-trips under load. */
const MAX_MESSAGES_PER_POLL = 10;

/** SQS-backed queue — same `Queue` contract as createRedisListQueue. */
export function createSqsQueue(queueUrl: string, region: string): Queue {
  const client = new SQSClient({ region });
  let stopped = false;

  return {
    async publish<T extends EventEnvelope>(event: T): Promise<void> {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(event),
        }),
      );
    },

    async consume(handler: (event: EventEnvelope) => Promise<void>): Promise<void> {
      stopped = false;
      while (!stopped) {
        const result = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: MAX_MESSAGES_PER_POLL,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
          }),
        );

        for (const message of result.Messages ?? []) {
          if (!message.Body || !message.ReceiptHandle) continue;

          try {
            const event = JSON.parse(message.Body) as EventEnvelope;
            await handler(event);
            await client.send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: message.ReceiptHandle,
              }),
            );
          } catch (error) {
            console.error(`[sqs-queue] handler failed for message ${message.MessageId}`, error);
            // Deliberately not deleting: SQS redelivers this after the queue's
            // visibility timeout, and after maxReceiveCount redeliveries the
            // redrive policy moves it to the DLQ. Retry/DLQ come from queue
            // config, not from code here.
          }
        }
      }
    },

    stop() {
      stopped = true;
    },

    async close(): Promise<void> {
      client.destroy();
    },
  };
}
