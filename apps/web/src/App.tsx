import { useEffect, useRef, useState } from "react";
import { BucketGrid } from "./components/BucketGrid.js";
import { FilterBar } from "./components/FilterBar.js";
import { Hero } from "./components/Hero.js";
import { LeadDrawer } from "./components/LeadDrawer.js";
import { LeadTable } from "./components/LeadTable.js";
import { ErrorPage } from "./components/ErrorPage.js";
import { Toast } from "./components/Toast.js";
import { KnowledgePage } from "./components/KnowledgePage.js";
import { TopBar, type View } from "./components/TopBar.js";
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
import { fetchDemoBusiness, fetchOpenLeads, requestSuggestion } from "./lib/api.js";
import { knowledgeBasis, type KnowledgeBasis } from "./lib/knowledge.js";

const SUGGESTION_ERROR_MESSAGE: Record<string, string> = {
  provider_timeout: "The AI service timed out — try again.",
  provider_error: "The AI service couldn't generate a suggestion — try again.",
  invalid_output: "The AI service returned something unusable — try again.",
  provider_unavailable: "Couldn't reach the AI service — try again.",
};

const TOAST_DURATION_MS = 3200;
const SEND_CLOSE_DELAY_MS = 650;

export function App() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [businessName, setBusinessName] = useState(BUSINESS_NAME);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [view, setView] = useState<View>("recovery");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [retryCount, setRetryCount] = useState(0);

  const [status, setStatus] = useState<StatusMap>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Per lead, like the cached draft, so reopening a lead still shows what its draft was based on.
  const [bases, setBases] = useState<Record<string, KnowledgeBasis>>({});
  const [sent, setSent] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Guards against a slow suggestion response landing after the drawer
  // moved on to a different lead (or closed).
  const activeSuggestionLeadId = useRef<string | null>(null);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function updateLeadDraft(leadId: string, value: string) {
    setDraft(value);
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, draft: value } : lead)));
  }

  async function loadSuggestion(leadId: string) {
    activeSuggestionLeadId.current = leadId;
    setDraftLoading(true);
    setDraftError(null);
    try {
      const outcome = await requestSuggestion(leadId);
      if (activeSuggestionLeadId.current !== leadId) return;
      if (outcome.status === "ok") {
        updateLeadDraft(leadId, outcome.message);
        setBases((prev) => ({ ...prev, [leadId]: knowledgeBasis(outcome) }));
      } else {
        setDraftError(
          SUGGESTION_ERROR_MESSAGE[outcome.errorCode] ??
            "Couldn't generate a suggestion — try again.",
        );
      }
    } catch {
      if (activeSuggestionLeadId.current !== leadId) return;
      setDraftError("Couldn't reach the server — try again.");
    } finally {
      if (activeSuggestionLeadId.current === leadId) setDraftLoading(false);
    }
  }

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
          setBusinessId(business._id);
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
    setDraftError(null);
    setSent(false);
    if (lead.draft) {
      activeSuggestionLeadId.current = null;
    } else {
      void loadSuggestion(lead.id);
    }
  }

  function closeDrawer() {
    activeSuggestionLeadId.current = null;
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

  const topBar = (
    <TopBar
      businessName={businessName}
      syncedAgo={SYNCED_AGO_LABEL}
      view={view}
      onViewChange={setView}
    />
  );

  if (view === "knowledge" && businessId) {
    return (
      <div className="app-shell">
        {topBar}
        <div className="page">
          <KnowledgePage businessId={businessId} />
        </div>
        {toast ? <Toast message={toast} /> : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {topBar}

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
          draftLoading={draftLoading}
          draftError={draftError}
          basis={draftError ? null : (bases[selectedLead.id] ?? null)}
          sent={sent}
          onClose={closeDrawer}
          onEditDraft={(value) => updateLeadDraft(selectedLead.id, value)}
          onRegenerate={() => loadSuggestion(selectedLead.id)}
          onSend={send}
          onDismiss={dismiss}
        />
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}
