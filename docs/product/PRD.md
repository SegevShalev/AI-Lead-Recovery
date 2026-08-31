# PRD: AI Lead Recovery — Lost Revenue Recovery Platform

**Status:** Draft v0.1 **Owners:** Erez, Segev **Date:** August 31, 2026 **Market:** Israel (Hebrew-first), SMB verticals

---

## 1. Executive Summary

Small and medium businesses receive inbound leads through many disconnected channels — WhatsApp, phone, Instagram, Facebook, website forms, email. A large share of these leads are never converted, not because the offer was bad, but because **nobody followed up in time**. A customer asks "how much does treatment cost?", gets an answer, goes quiet — and the business moves on without ever revisiting the conversation.

This product identifies those stalled conversations and dormant relationships automatically, and tells the business owner exactly how much money is sitting unclaimed and who to contact to recover it.

The pitch is deliberately **not** "AI CRM." It is: **"We find the money your business is leaving on the floor."**

## 2. Problem Statement

- Leads arrive across many channels with no unified tracking.
- Staff are busy running the business (not doing sales ops), so follow-up is inconsistent and easily forgotten.
- There is no visibility into how much revenue is being lost this way — so it's never prioritized.
- Existing CRMs require active, disciplined data entry and monitoring; most small businesses in these verticals don't use one, or don't use it consistently.

**Illustrative scenarios (from the original concept):**

- A lead messaged 3 hours ago and never got a reply.
- A customer received a price quote 4 days ago; no one followed up.
- A customer asked to book an appointment, but no one confirmed a time with them.
- A repeat customer who used to come in every two months hasn't been back in six.

## 3. Vision & Positioning

**Vision:** Become the default "safety net" that sits on top of a small business's existing communication channels and guarantees that no paying customer falls through the cracks.

**Positioning statement:** Not a CRM replacement. Not a chatbot. A **revenue recovery layer** that watches existing conversations and surfaces exactly where money is being lost, in currency terms the owner immediately understands.

**Key differentiation:** | Typical framing | This product's framing | |---|---| | "AI-powered CRM" | "We find money you're already leaving on the table" | | Feature list (automation, tags, pipelines) | A single number: ₪ Potential Recoverable Revenue | | Requires the owner to change their workflow | Sits on top of the tools they already use (WhatsApp, etc.) |

## 4. Target Market

**Candidate verticals** (high-touch, quote/appointment-driven, high per-customer value, currently WhatsApp/phone-heavy):

- Auto shops / garages (מוסכים) — **recommended MVP niche**
- Clinics / medical aesthetics
- Cosmeticians / beauty salons
- Lawyers
- Dentists
- Contractors / plumbers / HVAC
- Real estate agents
- Personal trainers / coaches

**Why start with one niche (garages, proposed):**

- Clear, recurring transaction value (repairs, services) that makes "recoverable revenue" easy to quantify.
- Heavy reliance on WhatsApp and phone, low CRM adoption — high pain, low existing tooling to compete with.
- Owners are used to thinking in ₪ per job, which matches the product's "we found you ₪X" pitch.
- Note: this is a starting hypothesis, not a validated choice — worth a quick round of customer conversations before committing.

## 5. User Personas

**Primary: The Owner / Manager**

- Runs a small business (1–15 employees), wears many hats, not a "sales ops" person.
- Cares about one thing from this tool: "is this making me money, and how much."
- Low tolerance for complex dashboards or setup friction.

**Secondary: The Front-Desk / Service Advisor**

- The person actually handling WhatsApp/phone conversations day to day.
- Needs simple, actionable prompts ("call Daniel back about his quote"), not a new system to learn.

## 6. Core Value Proposition

> "We tell you exactly which customers you're about to lose, and how much they're worth — before you lose them."

The product must always answer, at a glance:

1. How much money is currently at risk of being lost?
2. Who, specifically, needs a follow-up right now?
3. What should be said to them?

## 7. MVP Scope

### 7.1 In scope

1. **Channel connection (Phase 1: WhatsApp only)**
   - Connect the business's WhatsApp (Business API or existing tool/CRM integration).
   - Ingest conversation history and new messages.
2. **Stalled-conversation detection engine**
   - Detect a customer message that received no reply within a configurable time window.
   - Detect a quote/price sent with no customer response after N days.
   - Detect an appointment request that was never confirmed with a time slot.
   - Detect a previously-recurring customer who has gone quiet beyond their typical cadence.
3. **Follow-up suggestions**
   - For each detected case, generate a suggested follow-up message (tone/context aware) that staff can send with one click, or edit first.
4. **Dashboard**
   - Headline metric: **₪ Potential Recoverable Revenue** (estimated).
   - Breakdown: leads without follow-up / quotes without a response / dormant repeat customers, each with count and estimated ₪ value.
   - A per-lead list with a one-click "Recover" action.
5. **Basic outcome tracking**
   - Mark a recovered lead as "won" / "lost" / "no response" to measure real recovered revenue over time and prove ROI.

### 7.2 Explicitly out of scope for MVP

- Additional channels (Instagram, Facebook, phone, email, website chat) — planned for Phase 2.
- Fully automated (no human in the loop) outreach.
- Multi-niche support — MVP targets one vertical only.
- Deep two-way CRM sync / pipeline management.

## 8. Post-MVP / Future Features

- Additional channel integrations: Instagram DM, Facebook Messenger, phone (call logs/voicemail), email, website chat widget.
- Automatic sending of follow-ups (with guardrails and opt-in).
- Lead scoring / prioritization (which stalled leads are most likely to convert).
- Estimated deal value learned per-business rather than manually configured.
- Multi-niche templates (adjust detection rules and messaging tone per vertical).
- Native integrations with common CRMs/tools instead of relying solely on WhatsApp ingestion.
- Team performance view (which staff member is slow to respond).

## 9. Dashboard — Illustrative Spec

Primary view, in order of visual priority:

₪18,400  Potential Recoverable Revenue

23  leads with no follow-up

7   quotes with no response

9   recurring customers who disappeared

[ Recover ]  → per-lead detail + suggested message + one-click send

Each line item should be clickable and drill into: customer name, channel, last message, time elapsed, estimated value, and the suggested follow-up.

## 10. Success Metrics (Business)

- **Activation:** business connects a channel and sees a populated dashboard within first session.
- **Engagement:** % of surfaced leads acted on (message sent) per week.
- **Core value metric:** ₪ actually recovered (marked "won") vs. ₪ estimated at risk.
- **Retention:** month-2 and month-3 subscription retention.
- **Expansion signal:** businesses asking to add more channels/users.

## 11. Business Model & Pricing (hypothesis)

- **Flat subscription:** ₪200–1,000+/month depending on business size / lead volume.
- **Alternative / complementary model:** pricing tied to leads recovered (e.g., a fee per confirmed "won" lead, or a hybrid base fee + success fee).
- **Why this pricing story works:** ROI is easy to demonstrate — if the product recovers even one ₪2,000 customer, a ₪300/month fee is a trivial comparison. This should be the core of the sales narrative, not the feature set.

_(These are directional starting points from the original concept, not validated numbers — worth testing directly with early customers.)_

## 12. High-Level Technical Considerations

_(For discussion in the planning/architecture phase — not final decisions.)_

- **Stack fit:** aligns naturally with a MERN-based build (Node/Express backend, MongoDB for conversation/lead storage, React frontend for the dashboard).
- **WhatsApp ingestion:** requires either the official WhatsApp Business Platform API, or integration with a BSP (Business Solution Provider) / existing tool the business already uses — needs research into access requirements and cost.
- **Conversation classification:** needs logic (rule-based to start, NLP-assisted later) to detect message intent — "price question," "quote sent," "booking request" — and to detect "no reply" states.
- **Scheduled detection jobs:** background jobs that periodically scan conversations for staleness thresholds and recompute the recoverable-revenue estimate.
- **Estimated deal value:** MVP will likely need a simple, manually-configured average ticket value per business, refined later with real data.
- **Notifications:** dashboard plus a push channel (WhatsApp/email/SMS) to alert staff about newly detected at-risk leads.

## 13. Risks & Open Questions

- **WhatsApp platform access & policy:** cost, approval process, and messaging policy limits (e.g., template message rules, 24-hour session windows) need early research — this could materially shape what's possible in MVP.
- **False positives:** flagging a "lost lead" that was actually handled outside the tracked channel (e.g., resolved by phone) could erode trust quickly — needs a way for staff to mark "already handled."
- **Data privacy:** handling customer conversation content requires clear data-handling and consent practices, especially with personal/medical information in some verticals (e.g., clinics).
- **Niche validation:** garages is a hypothesis; needs a handful of real conversations with target business owners before committing engineering time.
- **Manual vs. automated outreach:** how much of the follow-up should be human-sent vs. tool-sent, especially given messaging platform policies and the risk of feeling "spammy."

## 14. Next Steps

1. Validate the niche choice with 3–5 conversations with real business owners (garages or an alternative candidate).
2. Move to **planning + architecture** (system design, data model, WhatsApp integration approach).
3. Move to **UX/design** for the dashboard and the per-lead "Recover" flow.
4. Define the MVP build plan and timeline with Segev.

---

_This document reflects the initial concept as defined by Erez and Segev and is intended as a living draft to be refined through the planning and design phases._
