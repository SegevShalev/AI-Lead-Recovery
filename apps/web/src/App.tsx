import { useEffect, useRef, useState } from "react";
import { BucketGrid } from "./components/BucketGrid.js";
import { FilterBar } from "./components/FilterBar.js";
import { Hero } from "./components/Hero.js";
import { LeadDrawer } from "./components/LeadDrawer.js";
import { LeadTable } from "./components/LeadTable.js";
import { ErrorPage } from "./components/ErrorPage.js";
import { Toast } from "./components/Toast.js";
import { TopBar } from "./components/TopBar.js";
import { BUSINESS_NAME, REPLY_RATE_LABEL, SYNCED_AGO_LABEL, type Lead } from "./data/leads.js";
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
import { fetchDemoBusiness, fetchOpenLeads } from "./lib/api.js";

const TOAST_DURATION_MS = 3200;
const SEND_CLOSE_DELAY_MS = 650;

export function App() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [businessName, setBusinessName] = useState(BUSINESS_NAME);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [retryCount, setRetryCount] = useState(0);

  const [status, setStatus] = useState<StatusMap>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const business = await fetchDemoBusiness();
        if (!business) {
          if (!cancelled) setLoadError("No business seeded yet — run the seed script first.");
          return;
        }
        const openCases = await fetchOpenLeads(business._id);
        if (!cancelled) {
          setBusinessName(business.name);
          setLeads(openCases);
        }
      } catch (error) {
        if (!cancelled)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Failed to load dashboard — the server may be unreachable.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

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

  const selectedLead = leads.find((lead) => lead.id === selectedId) ?? null;

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

  if (loading) {
    return (
      <div className="app-shell">
        <TopBar businessName={businessName} syncedAgo={SYNCED_AGO_LABEL} />
        <div className="page">Loading dashboard…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-shell">
        <TopBar businessName={businessName} syncedAgo={SYNCED_AGO_LABEL} />
        <ErrorPage message={loadError} onRetry={() => setRetryCount((count) => count + 1)} />
      </div>
    );
  }

  const rows = filteredSortedRows(leads, status, filter);
  const buckets = bucketSummaries(leads, status);
  const total = heroTotal(leads, status);
  const openCount = openLeads(leads, status).length;
  const recoveredTotal = recoveredThisMonth(leads, status);
  const topFive = topFiveValue(leads, status);

  return (
    <div className="app-shell">
      <TopBar businessName={businessName} syncedAgo={SYNCED_AGO_LABEL} />

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
