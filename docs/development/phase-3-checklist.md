# Phase 3 Checklist — AI Service

Working split for Phase 3 of the [roadmap](roadmap.md). Same shape as
[Phase 2](phase-2-checklist.md): two tracks, plus one seam both of us verify
together. Track numbers/people default to the Phase 2 mapping (Erez = the
track that builds a new adapter behind an interface, Segev = the track that
wires it into the app) — swap freely if you'd rather rotate.

**Exit criteria (roadmap):** the user can request and review a grounded,
schema-valid follow-up suggestion.

Current state: `services/ai-service` is a health-check skeleton only (no
`/internal/suggestions` route yet), and there's no
`POST /api/recovery-cases/:id/suggestion` route on the API side either —
`apps/web/src/lib/api.ts` already has a `draft: ""` placeholder with a
comment pointing at this phase. Clean slate on both tracks.

## Track 1 — AI-service internals (Erez)

Everything that lives inside `services/ai-service`. Doesn't touch
`services/api` or `apps/web`.

- [ ] **Provider-neutral `SuggestionGenerator`** — define the interface
      (input: recovery case + selected conversation context; output:
      Zod-validated `{ message, language, reason, confidence?, model,
      promptVersion }` per
      [ai-architecture.md](../architecture/ai-architecture.md#stage-1--structured-generation)).
      Provider SDK types must not leak past this boundary.
- [ ] **Mock/deterministic provider** — `AI_PROVIDER=mock` is already the
      `.env.example` default and the README calls it out as acceptable
      until the rest of the app works. Build this first — it's what lets
      Track 2 start immediately without waiting on a model choice or API
      key.
- [ ] **One real model adapter** — behind the same interface (e.g.
      Anthropic or OpenAI). See the `claude-api` skill for model/pricing
      reference if using Claude.
- [ ] **Structured output with Zod** — validate model output before
      returning; invalid JSON is a failure case, not a crash (see AI
      failure/degraded mode below).
- [ ] **Prompt versioning** — prompt templates live under
      `services/ai-service/prompts` (per the `ai-features` skill); every
      generation returns the `promptVersion` that produced it.
- [ ] **Hebrew follow-up generation** — the actual prompt content, held to
      the `ai-features` skill's bar: concise, references the real
      situation, never invents a price/appointment/discount, returns only
      the requested fields.
- [ ] **AI failure/degraded mode (service side)** — provider timeout,
      provider error, or output that still fails schema validation after
      retry returns a typed degraded result, not a thrown 500. Per the
      `ai-coding` skill: deterministic fallback behavior, no
      chain-of-thought ever stored.
- [ ] **`POST /internal/suggestions`** wiring all of the above (per
      [service-boundaries.md](../architecture/service-boundaries.md#services-ai-service)).
- [ ] Tests per the `ai-coding` skill's "Done" bar: malformed model output,
      provider failure, prompt-injection-like customer content (customer
      messages are untrusted data, never instructions).

## Track 2 — Integration + human review (Segev)

Doesn't touch AI provider calls or prompt content at all — builds against
Track 1's mock provider from day one.

- [ ] **`POST /api/recovery-cases/:id/suggestion`** — calls
      `services/ai-service`'s `/internal/suggestions` with the case's
      conversation context.
- [ ] **Persist the result** — `RecoveryCase.suggestionId` already exists
      on the schema (`services/api/src/db/models.ts:119`,
      `packages/shared/src/domain.ts:79`) but nothing writes to it yet.
- [ ] **AI failure/degraded mode (API side)** — when the AI service
      returns degraded or is unreachable, the endpoint responds with a
      typed error body instead of a 500, so the UI has something sane to
      render.
- [ ] **Dashboard "Recover" flow** — request a suggestion, show it, let a
      human edit it, then approve/mark-as-sent. No real send yet
      ([ADR-002](../decisions/ADR-002-no-real-whatsapp-first.md)) — this
      replaces the `draft: ""` placeholder in `apps/web/src/lib/api.ts`.
      `apps/web` owns human approval/editing of AI suggestions per
      [service-boundaries.md](../architecture/service-boundaries.md#appsweb)
      but must not call the AI provider directly.

## Shared — do together, not split

- [ ] **Agree the `SuggestionGenerator` contract before either track
      starts writing code.** Track 2 needs the exact Zod shape (field
      names, what's optional, the degraded-mode error shape) to build
      against the mock provider before Track 1's real adapter exists —
      same reasoning as Phase 2's transport/idempotency seam: the two
      sides only fit together if the contract was fixed on purpose, not
      assumed.
- [ ] **AI failure/degraded-mode seam.** Once Track 1's degraded result
      and Track 2's API/UI error handling both exist: deliberately break
      the AI service (bad `AI_API_KEY`, or a fault injected into the mock
      provider for the test) and confirm end to end — the AI service
      doesn't crash, the API doesn't 500 the whole request, and the
      dashboard shows a clear "couldn't generate a suggestion" state
      instead of breaking. Worth doing together rather than assuming
      either side's error handling covers the other.

## Notes

- Phase 4 (RAG) builds directly on top of Track 1's `SuggestionGenerator`
  (its "context assembly" step feeds straight into generation) — don't
  start Phase 4 work in parallel with this phase, the interface it needs
  doesn't exist yet.
- Follow the normal [branching workflow](branching-and-versioning.md) —
  feature branches off `dev`, one PR per coherent chunk (e.g.
  `feature/ai-suggestion-generator`, `feature/recovery-case-suggestion-flow`),
  not one giant Phase 3 branch.
