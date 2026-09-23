import { useEffect, useState } from "react";
import {
  createKnowledge,
  deleteKnowledge,
  fetchKnowledge,
  reindexKnowledge,
  updateKnowledge,
  type KnowledgeDocument,
  type KnowledgeDocumentInput,
  type KnowledgeDocumentType,
} from "../lib/api.js";
import { groupByType, KNOWLEDGE_TYPE_LABEL } from "../lib/knowledge.js";

interface KnowledgePageProps {
  businessId: string;
}

const EMPTY_FORM: KnowledgeDocumentInput = { type: "service", title: "", content: "" };

/**
 * The owner's business facts (prices, hours, policies) that suggestions are
 * grounded on (docs/development/phase-4-checklist.md Track 2). Content is
 * Hebrew, so text fields use dir="auto" inside this English UI.
 */
export function KnowledgePage({ businessId }: KnowledgePageProps) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = no form open; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<KnowledgeDocumentInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setDocuments(await fetchKnowledge(businessId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load business knowledge.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [businessId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  function startAdd() {
    setEditing("new");
    setForm(EMPTY_FORM);
  }

  function startEdit(doc: KnowledgeDocument) {
    setEditing(doc._id);
    setForm({ type: doc.type, title: doc.title, content: doc.content });
  }

  function save() {
    const target = editing;
    void run(async () => {
      if (target === "new") await createKnowledge(businessId, form);
      else if (target) await updateKnowledge(businessId, target, form);
      setEditing(null);
    });
  }

  function remove(doc: KnowledgeDocument) {
    if (!window.confirm(`Delete "${doc.title}"? The AI will stop using it.`)) return;
    void run(async () => {
      const result = await deleteKnowledge(businessId, doc._id);
      if (result === "index_unavailable") {
        throw new Error(
          `Couldn't remove "${doc.title}" from the AI's memory right now, so nothing was deleted. Try again in a moment.`,
        );
      }
    });
  }

  const pendingCount = documents.filter((doc) => doc.indexStatus === "pending").length;
  const canSave = form.title.trim() !== "" && form.content.trim() !== "" && !busy;

  const formCard = (
    <div className="knowledge-form">
      <div className="knowledge-form__row">
        <label className="knowledge-form__field">
          <span className="knowledge-form__label">Type</span>
          <select
            className="knowledge-form__input"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as KnowledgeDocumentType })}
          >
            {Object.entries(KNOWLEDGE_TYPE_LABEL).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="knowledge-form__field knowledge-form__field--grow">
          <span className="knowledge-form__label">Title</span>
          <input
            className="knowledge-form__input"
            dir="auto"
            value={form.title}
            maxLength={200}
            placeholder="e.g. החלפת רפידות בלמים"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
      </div>
      <label className="knowledge-form__field">
        <span className="knowledge-form__label">What should the AI know?</span>
        <textarea
          className="knowledge-form__input knowledge-form__textarea"
          dir="auto"
          value={form.content}
          placeholder="e.g. החלפת רפידות קדמיות: 450 ₪ כולל עבודה"
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
      </label>
      <div className="knowledge-form__actions">
        <button
          type="button"
          className="knowledge-btn knowledge-btn--primary"
          onClick={save}
          disabled={!canSave}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="knowledge-btn"
          onClick={() => setEditing(null)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="section-head section-head--flush">
        <div>
          <h2 className="section-head__title">Business knowledge</h2>
          <p className="section-head__subtitle">
            Prices, hours and policies the AI uses when it drafts a follow-up. It never makes these
            up — if it's not here, it won't quote it.
          </p>
        </div>
        {editing === null ? (
          <button type="button" className="knowledge-btn knowledge-btn--primary" onClick={startAdd}>
            + Add knowledge
          </button>
        ) : null}
      </div>

      {error ? <div className="knowledge-alert knowledge-alert--error">{error}</div> : null}
      {pendingCount > 0 ? (
        <div className="knowledge-alert">
          {pendingCount === 1 ? "1 item is" : `${pendingCount} items are`} saved but not yet
          available to the AI. Use “Retry” once the AI service is back.
        </div>
      ) : null}

      {editing === "new" ? formCard : null}

      {loading ? (
        <div className="knowledge-empty">Loading…</div>
      ) : documents.length === 0 && editing !== "new" ? (
        <div className="knowledge-empty">
          No business knowledge yet. Add your prices and opening hours so suggestions can use them.
        </div>
      ) : (
        groupByType(documents).map((group) => (
          <section key={group.type} className="knowledge-group">
            <h3 className="knowledge-group__title">{group.label}</h3>
            <div className="knowledge-list">
              {group.documents.map((doc) =>
                editing === doc._id ? (
                  <div key={doc._id}>{formCard}</div>
                ) : (
                  <div key={doc._id} className="knowledge-item">
                    <div className="knowledge-item__body">
                      <div className="knowledge-item__title" dir="auto">
                        {doc.title}
                      </div>
                      <div className="knowledge-item__content" dir="auto">
                        {doc.content}
                      </div>
                    </div>
                    <div className="knowledge-item__side">
                      {doc.indexStatus === "pending" ? (
                        <span
                          className="knowledge-status knowledge-status--pending"
                          title="Saved, but the AI can't use it until it's indexed."
                        >
                          Not yet used by AI
                        </span>
                      ) : (
                        <span className="knowledge-status">In use</span>
                      )}
                      <div className="knowledge-item__actions">
                        {doc.indexStatus === "pending" ? (
                          <button
                            type="button"
                            className="knowledge-link"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                async () => void (await reindexKnowledge(businessId, doc._id)),
                              )
                            }
                          >
                            Retry
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="knowledge-link"
                          disabled={busy || editing !== null}
                          onClick={() => startEdit(doc)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="knowledge-link knowledge-link--danger"
                          disabled={busy || editing !== null}
                          onClick={() => remove(doc)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>
        ))
      )}
    </>
  );
}
