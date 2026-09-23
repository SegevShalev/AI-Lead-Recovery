import { mongoose } from "@ai-lead-recovery/db";
import type {
  ConversationStatus,
  KnowledgeDocumentType,
  KnowledgeIndexStatus,
  MessageDirection,
  RecoveryCaseStatus,
  RecoveryCaseType,
  RetrievalInfo,
  RetrievalSource,
} from "@ai-lead-recovery/shared";

const { Schema, model } = mongoose;

/**
 * API owns Business/Customer/Conversation/Message persistence
 * (docs/architecture/service-boundaries.md). Field shapes follow
 * docs/architecture/data-model.md.
 */

interface BusinessDoc {
  name: string;
  vertical: string;
  currency: "ILS";
  averageTicketValue: number;
  settingsVersion: number;
}

const businessSchema = new Schema<BusinessDoc>(
  {
    name: { type: String, required: true },
    vertical: { type: String, required: true },
    currency: { type: String, enum: ["ILS"], required: true, default: "ILS" },
    averageTicketValue: { type: Number, required: true, min: 0 },
    settingsVersion: { type: Number, required: true, default: 1 },
  },
  { timestamps: true },
);

export const Business = model<BusinessDoc>("Business", businessSchema);

interface CustomerDoc {
  businessId: mongoose.Types.ObjectId;
  displayName: string;
  phone: string;
}

const customerSchema = new Schema<CustomerDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    displayName: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { timestamps: true },
);
customerSchema.index({ businessId: 1, phone: 1 }, { unique: true });

export const Customer = model<CustomerDoc>("Customer", customerSchema);

interface ConversationDoc {
  businessId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  channel: "whatsapp";
  status: ConversationStatus;
  lastMessageAt: Date;
}

const conversationSchema = new Schema<ConversationDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    channel: { type: String, enum: ["whatsapp"], required: true, default: "whatsapp" },
    status: { type: String, enum: ["open", "closed"], required: true, default: "open" },
    lastMessageAt: { type: Date, required: true },
  },
  { timestamps: true },
);
conversationSchema.index({ businessId: 1, lastMessageAt: -1 });

export const Conversation = model<ConversationDoc>("Conversation", conversationSchema);

interface MessageDoc {
  conversationId: mongoose.Types.ObjectId;
  direction: MessageDirection;
  text: string;
  occurredAt: Date;
  externalMessageId?: string;
  metadata?: Record<string, unknown>;
}

const messageSchema = new Schema<MessageDoc>({
  conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
  direction: { type: String, enum: ["inbound", "outbound"], required: true },
  text: { type: String, required: true },
  occurredAt: { type: Date, required: true },
  externalMessageId: { type: String },
  metadata: { type: Schema.Types.Mixed },
});
messageSchema.index({ conversationId: 1, occurredAt: 1 });
messageSchema.index(
  { externalMessageId: 1 },
  { unique: true, partialFilterExpression: { externalMessageId: { $type: "string" } } },
);

export const Message = model<MessageDoc>("Message", messageSchema);

/**
 * RecoveryCase is owned by services/recovery-worker (detection + writes).
 * The API only reads it and updates `status` (dashboard/outcome-tracking
 * endpoints) — this schema is API's own read/update view of the contract
 * described in docs/architecture/data-model.md, not a shared implementation.
 */
interface RecoveryCaseDoc {
  businessId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  type: RecoveryCaseType;
  status: RecoveryCaseStatus;
  estimatedValue: number;
  reason: string;
  detectedAt: Date;
  lastEvaluatedAt: Date;
  suggestionId?: string;
}

const recoveryCaseSchema = new Schema<RecoveryCaseDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    type: {
      type: String,
      enum: ["unanswered", "quote_no_response", "appointment_no_confirmation", "dormant_customer"],
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "handled", "won", "lost", "no_response"],
      required: true,
      default: "open",
    },
    estimatedValue: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    detectedAt: { type: Date, required: true },
    lastEvaluatedAt: { type: Date, required: true },
    suggestionId: { type: String },
  },
  { timestamps: true },
);
recoveryCaseSchema.index({ businessId: 1, status: 1, detectedAt: -1 });

export const RecoveryCase = model<RecoveryCaseDoc>("RecoveryCase", recoveryCaseSchema);

/**
 * One row per generated AI follow-up (docs/architecture/data-model.md#suggestion).
 * `reasoningSummary` is the model's short user-facing rationale, never
 * chain-of-thought (docs/architecture/ai-architecture.md). Immutable once
 * created, so no `updatedAt`. The retrieval* fields record which knowledge
 * the AI service grounded it on (optional: suggestions from before Phase 4
 * have none).
 */
interface SuggestionDoc {
  recoveryCaseId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  language: "he";
  message: string;
  reasoningSummary: string;
  model: string;
  promptVersion: string;
  retrievalStatus?: RetrievalInfo["status"];
  retrievalContextVersion?: string;
  retrievalSources?: RetrievalSource[];
}

const suggestionSchema = new Schema<SuggestionDoc>(
  {
    recoveryCaseId: { type: Schema.Types.ObjectId, ref: "RecoveryCase", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    language: { type: String, enum: ["he"], required: true },
    message: { type: String, required: true },
    reasoningSummary: { type: String, required: true },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    retrievalStatus: { type: String, enum: ["used", "empty", "failed"] },
    retrievalContextVersion: { type: String },
    retrievalSources: {
      type: [
        new Schema<RetrievalSource>(
          {
            documentId: { type: String, required: true },
            version: { type: Number, required: true },
            chunkId: { type: String, required: true },
            score: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
suggestionSchema.index({ recoveryCaseId: 1, createdAt: -1 });

export const Suggestion = model<SuggestionDoc>("Suggestion", suggestionSchema);

/**
 * RAG source of truth, owned by the API
 * (docs/architecture/data-model.md#businessknowledgedocument). The AI service
 * keeps a derived chunk index built from what the API sends it and never reads
 * this collection. `version` bumps on every write so the index can tell stale
 * updates apart; `indexStatus` is "pending" when the AI service couldn't be
 * reached on save (docs/development/phase-4-checklist.md, Track 2).
 */
interface BusinessKnowledgeDocumentDoc {
  businessId: mongoose.Types.ObjectId;
  type: KnowledgeDocumentType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  version: number;
  indexStatus: KnowledgeIndexStatus;
}

const businessKnowledgeDocumentSchema = new Schema<BusinessKnowledgeDocumentDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    type: {
      type: String,
      enum: ["service", "policy", "faq", "style", "example", "other"],
      required: true,
    },
    title: { type: String, required: true },
    content: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    version: { type: Number, required: true, min: 1, default: 1 },
    indexStatus: { type: String, enum: ["indexed", "pending"], required: true, default: "pending" },
  },
  { timestamps: true },
);
businessKnowledgeDocumentSchema.index({ businessId: 1, type: 1, version: 1 });

export const BusinessKnowledgeDocument = model<BusinessKnowledgeDocumentDoc>(
  "BusinessKnowledgeDocument",
  businessKnowledgeDocumentSchema,
);
