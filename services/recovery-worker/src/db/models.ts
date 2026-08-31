import { mongoose } from "@ai-lead-recovery/db";
import type {
  MessageDirection,
  RecoveryCaseStatus,
  RecoveryCaseType,
} from "@ai-lead-recovery/shared";

const { Schema, model } = mongoose;

/**
 * recovery-worker does not import services/api's models (that would share
 * implementation, not a contract — docs/architecture/service-boundaries.md).
 * Business/Conversation/Message are read-only views of collections API owns,
 * matching the shapes in docs/architecture/data-model.md. Only RecoveryCase
 * is owned (created/updated) here.
 */

interface BusinessDoc {
  averageTicketValue: number;
}

const businessSchema = new Schema<BusinessDoc>({
  averageTicketValue: { type: Number, required: true },
});

export const Business = model<BusinessDoc>("Business", businessSchema);

interface CustomerDoc {
  businessId: mongoose.Types.ObjectId;
  displayName: string;
  phone: string;
}

const customerSchema = new Schema<CustomerDoc>({
  businessId: { type: Schema.Types.ObjectId, required: true },
  displayName: { type: String, required: true },
  phone: { type: String, required: true },
});

export const Customer = model<CustomerDoc>("Customer", customerSchema);

interface ConversationDoc {
  businessId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
}

const conversationSchema = new Schema<ConversationDoc>({
  businessId: { type: Schema.Types.ObjectId, required: true },
  customerId: { type: Schema.Types.ObjectId, required: true },
});

export const Conversation = model<ConversationDoc>("Conversation", conversationSchema);

interface MessageDoc {
  conversationId: mongoose.Types.ObjectId;
  direction: MessageDirection;
  occurredAt: Date;
}

const messageSchema = new Schema<MessageDoc>({
  conversationId: { type: Schema.Types.ObjectId, required: true },
  direction: { type: String, enum: ["inbound", "outbound"], required: true },
  occurredAt: { type: Date, required: true },
});

export const Message = model<MessageDoc>("Message", messageSchema);

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
}

const recoveryCaseSchema = new Schema<RecoveryCaseDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true },
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
  },
  { timestamps: true },
);
recoveryCaseSchema.index({ businessId: 1, status: 1, detectedAt: -1 });

export const RecoveryCase = model<RecoveryCaseDoc>("RecoveryCase", recoveryCaseSchema);
