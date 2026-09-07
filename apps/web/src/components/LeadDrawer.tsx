import { KIND_LABEL, type Lead } from "../data/leads.js";
import { formatElapsed, formatMoney } from "../lib/format.js";

interface LeadDrawerProps {
  lead: Lead;
  draft: string;
  draftLoading: boolean;
  draftError: string | null;
  sent: boolean;
  onClose: () => void;
  onEditDraft: (value: string) => void;
  onRegenerate: () => void;
  onSend: () => void;
  onDismiss: () => void;
}

export function LeadDrawer({
  lead,
  draft,
  draftLoading,
  draftError,
  sent,
  onClose,
  onEditDraft,
  onRegenerate,
  onSend,
  onDismiss,
}: LeadDrawerProps) {
  const elapsed = formatElapsed(lead.elapsedDays);
  return (
    <>
      <button type="button" className="overlay" aria-label="Close" onClick={onClose} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${lead.name} conversation`}
      >
        <div className="drawer__head">
          <div>
            <div className="drawer__name">{lead.name}</div>
            <div className="drawer__meta">
              {lead.vehicle} · {lead.phone}
            </div>
          </div>
          <button type="button" className="drawer__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer__stats">
          <div className="drawer__stat">
            <div className="drawer__stat-label">At risk</div>
            <div className="drawer__stat-value drawer__stat-value--accent">
              {formatMoney(lead.value)}
            </div>
          </div>
          <div className="drawer__stat">
            <div className="drawer__stat-label">Silent for</div>
            <div className="drawer__stat-value">{elapsed}</div>
          </div>
          <div className="drawer__stat">
            <div className="drawer__stat-label">Type</div>
            <div className="drawer__stat-text">{KIND_LABEL[lead.kind]}</div>
          </div>
        </div>

        <div className="drawer__thread">
          <div className="drawer__thread-title">Conversation history</div>
          {lead.thread.map((message, i) => (
            <div key={i} className={`msg msg--${message.from === "us" ? "us" : "them"}`}>
              <div className="msg__bubble">
                <div className="msg__text">{message.text}</div>
                <div className="msg__meta">{message.time}</div>
              </div>
            </div>
          ))}
          <div className="drawer__silence">
            <div className="drawer__silence-line" />
            <div className="drawer__silence-label">{elapsed} of silence</div>
            <div className="drawer__silence-line" />
          </div>
        </div>

        <div className="composer">
          <div className="composer__head">
            <div className="composer__badge-line">
              <span className="composer__badge">Suggested follow-up</span>
              <span className="composer__rationale">{lead.rationale}</span>
            </div>
            <button
              type="button"
              className="composer__rewrite"
              onClick={onRegenerate}
              disabled={draftLoading}
            >
              {draftLoading ? "Drafting…" : "Rewrite"}
            </button>
          </div>
          {draftError ? (
            <div className="composer__error">
              {draftError}
              <button type="button" className="composer__error-retry" onClick={onRegenerate}>
                Try again
              </button>
            </div>
          ) : null}
          <textarea
            className="composer__textarea"
            value={draft}
            disabled={draftLoading}
            placeholder={draftLoading ? "Drafting a follow-up…" : undefined}
            onChange={(e) => onEditDraft(e.target.value)}
          />
          <div className="composer__actions">
            <button
              type="button"
              className="composer__send"
              onClick={onSend}
              disabled={draftLoading || !draft}
            >
              {sent ? "Sent ✓" : "Send on WhatsApp"}
            </button>
            <button type="button" className="composer__dismiss" onClick={onDismiss}>
              Not worth chasing
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
