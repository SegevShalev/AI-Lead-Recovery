import { KIND_LABEL, type Lead } from "../data/leads.js";
import type { StatusMap } from "../lib/dashboard.js";
import { formatElapsed, formatMoney, initialsOf } from "../lib/format.js";

interface LeadTableProps {
  rows: Lead[];
  status: StatusMap;
  onOpen: (lead: Lead) => void;
}

function elapsedClassName(days: number): string {
  if (days > 30) return "lead-row__elapsed lead-row__elapsed--danger";
  if (days > 10) return "lead-row__elapsed lead-row__elapsed--warn";
  return "lead-row__elapsed";
}

export function LeadTable({ rows, status, onOpen }: LeadTableProps) {
  return (
    <div className="lead-table">
      {rows.map((lead) => {
        const leadStatus = status[lead.id];
        const btnLabel =
          leadStatus === "sent" ? "Sent ✓" : leadStatus === "dismissed" ? "Dismissed" : "Recover";
        return (
          <button
            key={lead.id}
            type="button"
            className={`lead-row${leadStatus ? " lead-row--resolved" : ""}`}
            onClick={() => onOpen(lead)}
          >
            <div className="lead-row__customer">
              <div className="lead-row__avatar">{initialsOf(lead.name)}</div>
              <div>
                <div className="lead-row__name">{lead.name}</div>
                <div className="lead-row__vehicle">{lead.vehicle}</div>
              </div>
            </div>
            <div className="lead-row__thread">
              <div className="lead-row__badge-line">
                <span className="lead-row__badge">WhatsApp</span>
                <span className="lead-row__kind">{KIND_LABEL[lead.kind]}</span>
              </div>
              <div className="lead-row__snippet">&ldquo;{lead.snippet}&rdquo;</div>
            </div>
            <div className={elapsedClassName(lead.elapsedDays)}>
              {formatElapsed(lead.elapsedDays)} ago
            </div>
            <div className="lead-row__value">{formatMoney(lead.value)}</div>
            <div className="lead-row__action">
              <span
                className={leadStatus ? "lead-row__action-btn--resolved" : "lead-row__action-btn"}
              >
                {btnLabel}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
