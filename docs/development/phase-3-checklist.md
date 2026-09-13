# Phase 3 Checklist — AI Service

Working split for Phase 3 of the [roadmap](roadmap.md). Same shape as
[Phase 2](phase-2-checklist.md): two tracks, plus one seam both of us verify
together. Track numbers/people default to the Phase 2 mapping (Erez = the
track that builds a new adapter behind an interface, Segev = the track that
wires it into the app) — swap freely if you'd rather rotate.

**Exit criteria (roadmap):** the user can request and review a grounded,
schema-valid follow-up suggestion.

Current state: Track 1 is done — `services/ai-service` has a working
`POST /internal/suggestions` behind the `SuggestionGenerator`
(mock + Anthropic providers, retry/fallback, Hebrew prompt, tests). Track 2
is still a clean slate: there's no `POST /api/recovery-cases/:id/suggestion`
route on the API side yet, and `apps/web/src/lib/api.ts` still has the
`draft: ""` placeholder with a comment pointing at this phase.

## `SuggestionGenerator` contract — decided

Agreed up front so Track 2 can build against a mock without waiting on
Track 1's real adapter. Lives in `packages/shared/src/suggestions.ts`
(new file) so both services import the same types.

**Request** (API → AI service):

```ts
export const suggestionRequestSchema = z.object({
  recoveryCaseId: z.string(),
  businessId: z.string(),
  caseType: recoveryCaseTypeSchema,
  reason: z.string(), // the deterministic reason already on RecoveryCase
  estimatedValue: z.number().nonnegative(),
  customer: z.object({ displayName: z.string(), phone: z.string() }),
  conversationContext: z
    .array(
      z.object({
        direction: messageDirectionSchema,
        text: z.string(),
        occurredAt: z.string().datetime(),
      }),
    )
    .max(10),
  correlationId: z.string().optional(),
});
```

- **Context window**: the last outbound (business) message plus everything
  after it, capped at 10 messages. Covers the "unanswered" rule correctly
  (includes the message that never got a reply) and generalizes to
  `quote_no_response`/`appointment_no_confirmation` once those rules exist,
  without needing per-case-type message selection yet.
- **No `confidence` field.** Asking the model to self-report a confidence
  score with no calibration behind it (no self-consistency check, no
  grounding data yet) produces a number that looks scientific but isn't —
  exactly the "avoid unsupported claims" bar in
  [ai-architecture.md](../architecture/ai-architecture.md#prompt-injection-boundary).
  Revisit once Phase 4 grounding checks or Phase 5 evaluation give it a real
  basis.

**Response** — discriminated union, always returned with HTTP 200 (a
non-2xx/network failure is a _different_, unreachable-service case the API
must handle separately, see below):

```ts
export const suggestionResultSchema = z.object({
  status: z.literal("ok"),
  message: z.string(),
  language: z.literal("he"),
  reason: z.string(), // short user-facing rationale, never chain-of-thought
  model: z.string(), // whichever model actually produced this, see fallback below
  promptVersion: z.string(), // plain string, bumped by hand for now (e.g. "hebrew-followup-v1")
  generatedAt: z.string().datetime(),
});

export const suggestionDegradedSchema = z.object({
  status: z.literal("degraded"),
  errorCode: z.enum([
    "provider_timeout",
    "provider_error",
    "invalid_output",
    "provider_unavailable",
  ]),
  message: z.string().optional(),
});

export const suggestionResponseSchema = z.discriminatedUnion("status", [
  suggestionResultSchema,
  suggestionDegradedSchema,
]);
```

**Retry + fallback-model policy** (internal to Track 1, invisible to this
contract beyond the `model` field reflecting what actually ran):

1. Call the primary model (`AI_PROVIDER`).
2. On a retryable failure (timeout, provider error, output that fails Zod
   validation) retry the same model up to 2 more times (3 attempts total).
   Don't retry non-retryable failures (e.g. bad auth).
3. If all 3 attempts on the primary fail, make **one** attempt on a
   fallback model (`AI_FALLBACK_PROVIDER`, separate config/API key) —
   deliberately not another 3, to keep latency bounded for a human waiting
   on the result.
4. Only if the fallback attempt also fails, return `status: "degraded"`.
5. Log attempt count and which model ultimately served the request
   (structured log, per
   [ai-architecture.md](../architecture/ai-architecture.md#observability))
   — if requests are quietly serving from fallback often, that's worth
   noticing before Phase 5.

A user-facing "pick your preferred model" setting is a different feature
(business-level configuration) from this automatic failover — not in scope
for Phase 3; revisit alongside Phase 5's prompt/model comparison work if
wanted.

## Track 1 — AI-service internals (Erez)

Everything that lives inside `services/ai-service`. Doesn't touch
`services/api` or `apps/web`.

- [x] **Provider-neutral `SuggestionGenerator`** implementing the contract
      above. Provider SDK types must not leak past this boundary.
      [suggestionGenerator.ts](../../services/ai-service/src/suggestionGenerator.ts) —
      providers return raw `unknown`, the generator alone validates against
      `modelOutputSchema`.
- [x] **Mock/deterministic provider** — `AI_PROVIDER=mock` is already the
      `.env.example` default and the README calls it out as acceptable
      until the rest of the app works. Build this first — it's what lets
      Track 2 start immediately without waiting on a model choice or API
      key. Also useful for deliberately exercising the degraded path in
      tests without needing a real provider to fail on demand.
      [providers/mock.ts](../../services/ai-service/src/providers/mock.ts)
      takes a `failureMode` option for exactly that.
- [x] **One real model adapter** — behind the same interface (e.g.
      Anthropic or OpenAI). See the `claude-api` skill for model/pricing
      reference if using Claude.
      [providers/anthropic.ts](../../services/ai-service/src/providers/anthropic.ts),
      `claude-opus-5` by default. Prompts for plain JSON rather than the
      SDK's `zodOutputFormat` helper (version-incompatible with this repo's
      pinned zod 3.24 at the time of writing) — the generator's own Zod
      check is the actual validation gate either way.
- [x] **Fallback model adapter + retry policy** — implements the
      retry/fallback sequence above; add `AI_FALLBACK_PROVIDER` (and its
      own API key var) alongside the existing `AI_PROVIDER`/`AI_API_KEY`.
      [providerFactory.ts](../../services/ai-service/src/providerFactory.ts) +
      `packages/config/src/env.ts`.
- [x] **Structured output with Zod** — validate model output before
      returning; invalid JSON is a retryable failure, not a crash.
- [x] **Prompt versioning** — prompt templates live under
      `services/ai-service/prompts` (per the `ai-features` skill); every
      generation returns the `promptVersion` that produced it.
      `hebrew-followup-v1.txt` + [prompts.ts](../../services/ai-service/src/prompts.ts).
- [x] **Hebrew follow-up generation** — the actual prompt content, held to
      the `ai-features` skill's bar: concise, references the real
      situation, never invents a price/appointment/discount, returns only
      the requested fields.
- [x] **`POST /internal/suggestions`** wiring all of the above (per
      [service-boundaries.md](../architecture/service-boundaries.md#services-ai-service)).
- [x] Tests per the `ai-coding` skill's "Done" bar: malformed model output,
      provider failure (primary only, and primary+fallback both), and
      prompt-injection-like customer content (customer messages are
      untrusted data, never instructions).
      `suggestionGenerator.test.ts`, `prompts.test.ts`, `app.test.ts`.

## Track 2 — Integration + human review (Segev)

Doesn't touch AI provider calls or prompt content at all — builds against
Track 1's mock provider from day one, using the contract above.

- [ ] **`POST /api/recovery-cases/:id/suggestion`** — calls
      `services/ai-service`'s `/internal/suggestions` with the case's
      conversation context (last outbound message onward, capped at 10 —
      same rule as the contract).
- [ ] **Persist the result** — `RecoveryCase.suggestionId` already exists
      on the schema (`services/api/src/db/models.ts:119`,
      `packages/shared/src/domain.ts:79`) but nothing writes to it yet.
- [ ] **AI failure/degraded mode (API side)** — two distinct cases to
      handle: a well-formed `status: "degraded"` response, and the AI
      service being genuinely unreachable (network error/non-2xx). Neither
      should 500 the whole request; both should give the UI a typed error
      body to render.
- [ ] **Dashboard "Recover" flow** — request a suggestion, show it, let a
      human edit it, then approve/mark-as-sent. No real send yet
      ([ADR-002](../decisions/ADR-002-no-real-whatsapp-first.md)) — this
      replaces the `draft: ""` placeholder in `apps/web/src/lib/api.ts`.
      `apps/web` owns human approval/editing of AI suggestions per
      [service-boundaries.md](../architecture/service-boundaries.md#appsweb)
      but must not call the AI provider directly.

## Shared — do together, not split

- [x] **Agree the `SuggestionGenerator` contract before either track
      starts writing code** — see above. Same reasoning as Phase 2's
      transport/idempotency seam: the two sides only fit together if the
      contract was fixed on purpose, not assumed.
- [ ] **AI failure/degraded-mode seam.** Once Track 1's retry/fallback +
      degraded result and Track 2's API/UI error handling both exist:
      deliberately break the AI service (bad `AI_API_KEY` on both primary
      and fallback, or a fault injected into the mock provider) and
      confirm end to end — the AI service doesn't crash, the API doesn't
      500 the whole request, and the dashboard shows a clear "couldn't
      generate a suggestion" state instead of breaking. Also worth
      confirming the _fallback_ path specifically: break only the primary
      and verify a suggestion still comes back successfully with
      `model` reflecting the fallback. Worth doing together rather than
      assuming either side's error handling covers the other.

## Notes

- Phase 4 (RAG) builds directly on top of Track 1's `SuggestionGenerator`
  (its "context assembly" step feeds straight into generation) — don't
  start Phase 4 work in parallel with this phase, the interface it needs
  doesn't exist yet.
- Follow the normal [branching workflow](branching-and-versioning.md) —
  feature branches off `dev`, one PR per coherent chunk (e.g.
  `feature/ai-suggestion-generator`, `feature/recovery-case-suggestion-flow`),
  not one giant Phase 3 branch.
