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

## Repository guidance

Start with `AGENTS.md`, then the architecture docs and `prompts/bootstrap.md`.

The project intentionally avoids both extremes:

- not a monolith pretending to be cloud-native
- not dozens of microservices for architecture theater

The goal is to learn the concepts through a small system with real boundaries.
