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

### Prerequisites

- Node.js 20.x (see `engines` in `package.json`)
- [pnpm](https://pnpm.io) 9.x (`corepack enable` if you don't have it)
- Docker Desktop, running

### 0 → running

```bash
cp .env.example .env       # defaults already match docker-compose.yml
pnpm install
docker compose up -d --wait  # MongoDB + Redis — waits until both are actually ready
pnpm dev                   # runs api, recovery-worker, ai-service, and web in parallel, in one terminal
```

`pnpm dev` occupies its terminal (it's watching all four services at once) — open a **second terminal** for everything below.

`--wait` matters here: on a cold start (first pull of the `mongo`/`redis` images, or a slow Docker Desktop boot on Windows/Mac) the containers can take longer than `api`'s Mongo connection to become ready. `services/api` and `services/recovery-worker` now retry their Mongo connection with backoff instead of crashing outright, but if you skip `--wait` and see the web dashboard stuck on an error page or the terminal spamming `ECONNREFUSED` on `/api/businesses` right after starting, give it a few seconds — it recovers on its own once Mongo is up. If it doesn't, check `docker compose ps` to confirm both containers are healthy.

Verify the backend is actually up before touching the browser:

```bash
curl http://localhost:3000/health   # api
curl http://localhost:3002/health   # recovery-worker (mongoConnected/redisConnected should both be true)
```

Seed a demo Hebrew conversation so the dashboard has something to show:

```bash
pnpm --filter @ai-lead-recovery/api run seed
```

This prints the seeded business's id and publishes an already-stale message, so `recovery-worker`'s terminal should immediately log that it opened a recovery case. Each run adds one new randomized stalled lead (customer, message, timing) to the same demo business — run it as many times as you want more rows on the dashboard.

Then open the dashboard: **http://localhost:5173** (proxies `/api` and `/dev` to the api service on port 3000).

`--filter <package-name>` scopes a command to one workspace package (the `name` field in its `package.json`) instead of running it everywhere — useful for one-off commands like `seed` that only exist in one service. Everyday commands (`pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`) already loop over every package on their own and don't need it.

To reset local data: `docker compose down -v && docker compose up -d`.

### Viewing it from another device (e.g. your phone) — optional

`pnpm dev` binds the web dev server to localhost only. To reach it from a phone or another computer on the same Wi-Fi, run this instead of (or alongside) the web part of `pnpm dev`:

```bash
pnpm --filter @ai-lead-recovery/web run dev:host
```

Look for the printed `Network:` URL starting with `192.168.` or `10.` (ignore any `172.x.x.x` ones — those are virtual adapters like Docker/WSL, not reachable from other devices). Open that exact address, with `http://` explicit, from the other device on the same network — some mobile browsers auto-upgrade a bare IP:port to `https://`, which will fail since the dev server only speaks plain HTTP.

The api/recovery-worker/Mongo/Redis still need to be running as usual (`pnpm dev` in another terminal, or the rest of the stack some other way) — `dev:host` only exposes the frontend; the backend proxy still runs locally on the same machine, so the phone/other device only needs to reach your machine's IP, not the whole stack.

If it doesn't connect: check your machine's firewall isn't blocking inbound connections on port 5173, and confirm both devices are actually on the same Wi-Fi network (not one on Wi-Fi and one on mobile data, and not a "guest"/isolated Wi-Fi network that blocks device-to-device traffic).

## Repository guidance

Start with `AGENTS.md`, then the architecture docs and `prompts/bootstrap.md`.

The project intentionally avoids both extremes:

- not a monolith pretending to be cloud-native
- not dozens of microservices for architecture theater

The goal is to learn the concepts through a small system with real boundaries.
