import { useEffect, useRef, useState } from "react";
import { BucketGrid } from "./components/BucketGrid.js";
import { FilterBar } from "./components/FilterBar.js";
import { Hero } from "./components/Hero.js";
import { LeadDrawer } from "./components/LeadDrawer.js";
import { LeadTable } from "./components/LeadTable.js";
import { Toast } from "./components/Toast.js";
import { TopBar } from "./components/TopBar.js";
import {
  BUSINESS_NAME,
  LEADS,
  REPLY_RATE_LABEL,
  SYNCED_AGO_LABEL,
  type Lead,
} from "./data/leads.js";
import {
  bucketSummaries,
  filteredSortedRows,
  heroTotal,
  openLeads,
  recoveredThisMonth,
  topFiveValue,
  type FilterKey,
  type StatusMap,
} from "./lib/dashboard.js";
import { formatMoney } from "./lib/format.js";

const TOAST_DURATION_MS = 3200;
const SEND_CLOSE_DELAY_MS = 650;

export function App() {
  const [status, setStatus] = useState<StatusMap>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function flash(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  function openLead(lead: Lead) {
    setSelectedId(lead.id);
    setDraft(lead.draft);
    setSent(false);
  }

  function closeDrawer() {
    setSelectedId(null);
  }

  function toggleBucket(key: Lead["kind"]) {
    setFilter((prev) => (prev === key ? "all" : key));
  }

  const selectedLead = LEADS.find((lead) => lead.id === selectedId) ?? null;

  function send() {
    if (!selectedLead) return;
    setStatus((prev) => ({ ...prev, [selectedLead.id]: "sent" }));
    setSent(true);
    flash(
      `Message sent to ${selectedLead.name.split(" ")[0]} — ${formatMoney(selectedLead.value)} back in play.`,
    );
    setTimeout(closeDrawer, SEND_CLOSE_DELAY_MS);
  }

  function dismiss() {
    if (!selectedLead) return;
    setStatus((prev) => ({ ...prev, [selectedLead.id]: "dismissed" }));
    setSelectedId(null);
    flash("Removed from your recovery list.");
  }

  const rows = filteredSortedRows(LEADS, status, filter);
  const buckets = bucketSummaries(LEADS, status);
  const total = heroTotal(LEADS, status);
  const openCount = openLeads(LEADS, status).length;
  const recoveredTotal = recoveredThisMonth(LEADS, status);
  const topFive = topFiveValue(LEADS, status);

  return (
    <div className="app-shell">
      <TopBar businessName={BUSINESS_NAME} syncedAgo={SYNCED_AGO_LABEL} />

      <div className="page">
        <Hero
          total={total}
          openCount={openCount}
          recoveredTotal={recoveredTotal}
          replyRate={REPLY_RATE_LABEL}
          topFiveValue={topFive}
          onRecoverTop={() =>
            flash("Drafted 5 follow-ups — review them in the list before they send.")
          }
        />

        <BucketGrid buckets={buckets} activeFilter={filter} onToggle={toggleBucket} />

        <div className="section-head">
          <div>
            <h2 className="section-head__title">Money on the floor</h2>
            <p className="section-head__subtitle">
              Sorted by value at risk. One tap drafts the follow-up.
            </p>
          </div>
          <FilterBar active={filter} onSelect={setFilter} />
        </div>

        <LeadTable rows={rows} status={status} onOpen={openLead} />
        <div className="footnote">
          Estimates use your average ticket by job type over the last 12 months.
        </div>
      </div>

      {selectedLead ? (
        <LeadDrawer
          lead={selectedLead}
          draft={draft}
          sent={sent}
          onClose={closeDrawer}
          onEditDraft={setDraft}
          onRegenerate={() => setDraft(selectedLead.draft)}
          onSend={send}
          onDismiss={dismiss}
        />
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}
