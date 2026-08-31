import { mongoose } from "@ai-lead-recovery/db";
import type {
  ConversationStatus,
  MessageDirection,
  RecoveryCaseStatus,
  RecoveryCaseType,
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
