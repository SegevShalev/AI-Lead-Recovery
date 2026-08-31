import { randomUUID } from "node:crypto";
import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import { createRedisListQueue } from "@ai-lead-recovery/queue";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { Business, Conversation, Customer, Message } from "../db/models.js";

const DEMO_BUSINESS_NAME = "מוסך הצפון";

const CUSTOMER_NAMES = [
  "דני כהן",
  "מיכל לוי",
  "אבי מזרחי",
  "רותם בן דוד",
  "יוסי אברהם",
  "שירה גבאי",
  "עומר פרץ",
  "נועה שמעוני",
];

const INBOUND_MESSAGES = [
  "היי, כמה עולה טיפול לרכב שלי?",
  "אפשר תור להיום?",
  "הרכב משמיע רעש מוזר, אפשר לבדוק?",
  "כמה עולה החלפת שמן?",
  "מתי אתם פתוחים מחר?",
  "אני צריך להחליף בלמים, יש תור השבוע?",
  "קיבלתי הצעת מחיר, עדיין חושב על זה",
  "הרכב לא מתניע בבוקר, אפשר לעזור?",
  "יש לכם תור לבדיקת מזגן לפני הקיץ?",
  "המכונית רועדת כשעוצרים ברמזור, זה מסוכן?",
  "אתם עושים טסט לפני רישוי?",
];

function pickRandom<T>(items: T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error("pickRandom called with an empty array");
  return item;
}

function randomPhone(): string {
  const prefix = pickRandom(["50", "52", "53", "54", "58"]);
  const rest = Math.floor(1_000_000 + Math.random() * 9_000_000);
  return `+972${prefix}${rest}`;
}

/** Somewhere between 2 and 48 hours ago — always past the unanswered threshold. */
function randomPastOccurredAt(): Date {
  const hoursAgo = 2 + Math.random() * 46;
  return new Date(Date.now() - hoursAgo * 60 * 60_000);
}

/**
 * Seeds a stalled Hebrew WhatsApp conversation against the demo business
 * (docs/development/roadmap.md Phase 1 exit criterion), with a random
 * customer and message each run. Run with the api and recovery-worker dev
 * servers already up so the published event has a consumer.
 *
 * Note: the case's estimated value always comes from the business's
 * averageTicketValue (that's how the "unanswered" rule computes it, see
 * services/recovery-worker/src/worker.ts) — it isn't randomized per lead,
 * since inventing a per-message dollar figure the rule doesn't actually use
 * would be misleading rather than useful test data.
 */
async function seed() {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const queue = createRedisListQueue(env.REDIS_URL, "conversation-events");

  let business = await Business.findOne({ name: DEMO_BUSINESS_NAME });
  if (!business) {
    business = await Business.create({
      name: DEMO_BUSINESS_NAME,
      vertical: "garage",
      currency: "ILS",
      averageTicketValue: 500 + Math.floor(Math.random() * 20) * 50, // 500-1450, in steps of 50
      settingsVersion: 1,
    });
  }

  const customer = await Customer.create({
    businessId: business._id,
    displayName: pickRandom(CUSTOMER_NAMES),
    phone: randomPhone(),
  });

  const occurredAt = randomPastOccurredAt();
  const conversation = await Conversation.create({
    businessId: business._id,
    customerId: customer._id,
    channel: "whatsapp",
    status: "open",
    lastMessageAt: occurredAt,
  });

  const message = await Message.create({
    conversationId: conversation._id,
    direction: "inbound",
    text: pickRandom(INBOUND_MESSAGES),
    occurredAt,
  });

  const event: ConversationMessageReceivedEvent = {
    eventType: "conversation.message.received",
    eventVersion: 1,
    eventId: randomUUID(),
    occurredAt: occurredAt.toISOString(),
    tenantId: String(business._id),
    conversationId: String(conversation._id),
    messageId: String(message._id),
  };
  await queue.publish(event);

  console.log(
    `Seeded business ${business._id} (${business.name}) with a stalled conversation from ${customer.displayName}.`,
  );

  await queue.close();
  await disconnectMongo();
}

await seed();
