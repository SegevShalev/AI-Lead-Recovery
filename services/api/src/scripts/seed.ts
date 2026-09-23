import { randomUUID } from "node:crypto";
import { loadEnv } from "@ai-lead-recovery/config";
import { connectMongo, disconnectMongo } from "@ai-lead-recovery/db";
import { createQueueFromEnv } from "@ai-lead-recovery/queue";
import type { ConversationMessageReceivedEvent } from "@ai-lead-recovery/shared";
import { Conversation, Customer, Message } from "../db/models.js";
import {
  ensureGarageBusiness,
  loadGaragesFixture,
  upsertKnowledgeDocuments,
} from "./seedKnowledge.js";

/** The dashboard shows the first business, so conversations go here unless another key is passed. */
const DEFAULT_GARAGE_KEY = "north";

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
 * Seeds every garage in fixtures/knowledge/garages.json with its business
 * knowledge (idempotent, docs/development/phase-4-checklist.md Track 2), then
 * a stalled Hebrew WhatsApp conversation against one garage
 * (docs/development/roadmap.md Phase 1 exit criterion), with a random
 * customer and message each run. Pick the garage with its key, e.g.
 * `pnpm --filter @ai-lead-recovery/api seed south` (default: north). Run
 * with the api and recovery-worker dev servers already up so the published
 * event has a consumer.
 *
 * Note: the case's estimated value always comes from the business's
 * averageTicketValue (that's how the "unanswered" rule computes it, see
 * services/recovery-worker/src/worker.ts) — it isn't randomized per lead,
 * since inventing a per-message dollar figure the rule doesn't actually use
 * would be misleading rather than useful test data.
 */
async function seed() {
  const { garages } = loadGaragesFixture();
  const targetKey = process.argv[2] ?? DEFAULT_GARAGE_KEY;
  const target = garages.find((garage) => garage.key === targetKey);
  if (!target) {
    throw new Error(
      `Unknown garage "${targetKey}". Known: ${garages.map((g) => g.key).join(", ")}`,
    );
  }

  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const queue = createQueueFromEnv(env, "conversation-events");

  for (const garage of garages) {
    const garageBusinessId = await ensureGarageBusiness(garage);
    const knowledge = await upsertKnowledgeDocuments(garageBusinessId, garage.documents);
    console.log(
      `Knowledge for ${garage.key} (${garage.name}): ${knowledge.created} created, ${knowledge.updated} updated, ${knowledge.unchanged} unchanged.`,
    );
  }

  const businessId = await ensureGarageBusiness(target);

  const customer = await Customer.create({
    businessId,
    displayName: pickRandom(CUSTOMER_NAMES),
    phone: randomPhone(),
  });

  const occurredAt = randomPastOccurredAt();
  const conversation = await Conversation.create({
    businessId,
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
    tenantId: String(businessId),
    conversationId: String(conversation._id),
    messageId: String(message._id),
  };
  await queue.publish(event);

  console.log(
    `Seeded business ${businessId} (${target.name}) with a stalled conversation from ${customer.displayName}.`,
  );

  await queue.close();
  await disconnectMongo();
}

await seed();
