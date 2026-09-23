# Knowledge fixtures

Fake business knowledge for two garages, plus the retrieval eval set built on
it (docs/development/phase-4-checklist.md). They live at the repo root because
two owners use the same data, and a copy on each side would drift:

- **services/api** seed script loads `garages.json` into Mongo as
  `BusinessKnowledgeDocument`s (`pnpm --filter @ai-lead-recovery/api seed`).
- **services/ai-service** eval runner indexes the same documents and scores
  retrieval against `eval-questions.json`, without needing the API or Mongo.

Formats are Zod schemas in `packages/shared/src/knowledgeFixtures.ts`;
`services/api/src/scripts/seedKnowledge.test.ts` checks the two files agree.

## Rules for editing

- Garages are referenced by `key` (`north`, `south`), never a Mongo id.
- The garages must keep **different prices** for the same service — that's
  what makes a cross-tenant leak visible in a suggestion.
- An eval question's `expectedDocumentTitles` must match titles in its own
  garage. An empty array means the correct retrieval result is _nothing_
  (off-topic questions, or something only the other garage offers).
- Changing a document or question changes the eval baseline: re-run the full
  eval and say so in the PR.
