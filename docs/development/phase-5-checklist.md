# Phase 5 Checklist — AI engineering

Working split for Phase 5 of the [roadmap](roadmap.md). **Tracks are not
split yet.** Erez and Segev plan them together after the pre-tasks below.
When splitting, check who took the new-machinery track last time: in Phase 4,
Segev built the retrieval pipeline (Track 1).

**Exit criteria (roadmap):** changes to prompts/models can be measured
instead of judged only by eyeballing examples.

## Pre-tasks from Phase 4 — decide together first

Phase 4's exit evidence (the three-way comparison) raised questions that
need a joint decision. Full numbers and reasoning:
[Track 1 plan, Stage 7](phase-4-track-1-plan.md#stage-7--retrieval-eval--tuning)
and [Stage 9](phase-4-track-1-plan.md#stage-9--three-way-comparison--pr-ready).

Stage 9 in one table (`gpt-4.1-mini` + `text-embedding-3-small`, 18 questions,
2026-10-05):

| mode          | right doc shown | answered | facts stated | other numbers | input tok/q |
| ------------- | --------------- | -------- | ------------ | ------------- | ----------- |
| no knowledge  | 0/15            | 0/14     | 0/29         | 0             | 818         |
| all knowledge | 15/15           | 12/14    | 19/29        | 0             | 1,160       |
| rag           | 13/15           | 8/14     | 11/29        | 0             | 781         |

- [ ] **Finish Phase 4's shared seams** (they were always "do together"):
      the **tenant-isolation seam** (two seeded garages end to end, A's price
      never in B's suggestion or `sources`) and the **degrade seam** (bad
      `EMBEDDING_API_KEY` ⇒ suggestion still comes back, `retrieval.status:
  "failed"`, dashboard says no knowledge was used). Before the degrade
      seam, delete `knowledge_chunks`, or it fails on the collection size
      instead of the key (Track 1 plan, ⚠️ box).
- [ ] **Decide the knowledge strategy.** At our size "all knowledge" beat RAG
      (12 vs 8 answered) for ~$0.0002 more per message, and it can say "we
      don't offer that", which RAG can't. RAG scales to large knowledge bases.
      Options: 1. keep RAG as built; 2. send all knowledge; 3. **hybrid:** all knowledge while a business's chunks fit a prompt
      budget, RAG above it.
      The code already has both modes (`AllKnowledgeRetriever` in the eval).
      Whatever is chosen, record why in an ADR.
- [ ] **Fix the prompt's false "did you get our answer?" opener.** Almost
      every Stage 9 message opens with "רצינו לוודא שקיבלת את ההודעה/התשובה
      שלנו", although unanswered cases mean no answer was sent. That's an
      invented fact. Also seen: the right document was in the prompt but its
      price wasn't stated (brakes, in every mode). A prompt v3 change, measured
      on the same eval.
- [ ] **Make the eval see more than numbers.** "Facts stated" counts numbers
      only, so a correct "we're closed on Friday" scores 0, and non-numeric
      inventions ("our pizza menu", "happy to fix your puncture" at a garage
      that doesn't) aren't counted. Options: label expected non-numeric facts,
      a judged "invented fact" column (human or LLM judge), or both. This is
      the roadmap's "evaluation dataset" + "automated eval runner".
- [ ] **Grow the eval set and re-check retrieval.** 18 questions give a
      `minScore` gap only ~0.05 wide (0.40 chosen). Known misses: slang
      paraphrase ("ברקס"/"חורק" vs "רפידות בלמים") and a vague question
      ("כמה עולים בלמים?"). Levers: synonyms in documents, hybrid lexical
      search (Phase 4's "then experiment"), a larger embedding model. Scores
      are model-specific: re-run `eval:retrieval` after any embedder change.
- [ ] **Small fix:** the eval runners stop on a retrieval failure (right) but
      their silent logger hides the error code (one transient OpenAI error in
      Stage 7 showed only "check the embedder config").

## Context for planning

- Generation now runs on OpenAI (`AI_PROVIDER=openai`, `gpt-4.1-mini`)
  because no Anthropic API key was available. The Claude adapter still works
  with a key, so a prompt/model comparison (roadmap item) can include both.
- One OpenAI key serves embeddings and generation. Switching
  `EMBEDDING_PROVIDER` means deleting `knowledge_chunks` and reindexing
  (`services/ai-service/README.md`).
- Already in place for this phase: `eval:retrieval` and `eval:compare` with
  cost estimates, token usage per call, and retrieval tracing logs.
