# AI Lead Recovery — Engineering Plan

A learning-oriented real project for two developers to practice **AI engineering + AWS/cloud + microservices + Redis**, with the eventual goal of shipping a working revenue-recovery product.

## Product

The PRD describes a Hebrew-first, WhatsApp-first system that identifies stalled conversations, estimates potential recoverable revenue, and gives staff actionable follow-up suggestions.

## Architecture

Three services:

- `api` — synchronous product API and core persistence boundary
- `recovery-worker` — asynchronous microservice for deterministic recovery detection
- `ai-service` — internal AI/RAG service

Core infrastructure:

- MongoDB — source of truth
- Redis — cache, idempotency, short-lived coordination, later semantic cache
- SQS + DLQ — durable async work
- AWS ECS/Fargate — service deployment
- CDK — infrastructure as code

AI roadmap:

1. structured generation
2. embeddings + RAG
3. hybrid retrieval
4. semantic caching
5. evaluations
6. AI observability
7. optional GraphRAG/advanced experiments

## Getting started (local)

```bash
cp .env.example .env       # defaults already match docker-compose.yml
pnpm install
docker compose up -d       # MongoDB + Redis
pnpm dev                   # runs api, recovery-worker, ai-service, and web in parallel
```

Web dashboard: http://localhost:5173 (proxies `/api` and `/dev` to the api service on port 3000).

Seed a demo Hebrew conversation so the dashboard has something to show (in a second terminal, after `pnpm dev` is up):

```bash
pnpm --filter @ai-lead-recovery/api run seed
```

Each run adds one new randomized stalled lead (customer, message, timing) to the same demo business — run it as many times as you want more rows on the dashboard.

`--filter <package-name>` scopes a command to one workspace package (the `name` field in its `package.json`) instead of running it everywhere — useful for one-off commands like `seed` that only exist in one service. Everyday commands (`pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`) already loop over every package on their own and don't need it.

To reset local data: `docker compose down -v && docker compose up -d`.

### Viewing it from another device (e.g. your phone)

`pnpm dev` binds the web dev server to localhost only. To reach it from a phone or another computer on the same Wi-Fi:

```bash
pnpm --filter @ai-lead-recovery/web run dev:host
```

Look for the printed `Network:` URL starting with `192.168.` or `10.` (ignore any `172.x.x.x` ones — those are virtual adapters like Docker/WSL, not reachable from other devices). Open that exact address, with `http://` explicit, from the other device on the same network — some mobile browsers auto-upgrade a bare IP:port to `https://`, which will fail since the dev server only speaks plain HTTP.

The api/recovery-worker/Mongo/Redis still need to be running as usual (`pnpm dev` in another terminal, or the rest of the stack some other way) — `dev:host` only exposes the frontend; the backend proxy still runs locally on the same machine.

## Repository guidance

Start with `AGENTS.md`, then the architecture docs and `prompts/bootstrap.md`.

The project intentionally avoids both extremes:

- not a monolith pretending to be cloud-native
- not dozens of microservices for architecture theater

The goal is to learn the concepts through a small system with real boundaries.
