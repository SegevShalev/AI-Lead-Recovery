# ADR-001: Learning-oriented microservices

## Status
Accepted

## Context
The project is primarily a practical AI + AWS learning project, but it should still become a real usable application.

## Decision
Use three backend deployable units:
1. API
2. Recovery Worker
3. AI Service

Use SQS between API and Recovery Worker. Use Redis for cache/deduplication/short-lived coordination.

## Consequences
Positive:
- real asynchronous architecture
- independent worker scaling
- clear AI boundary
- practical AWS services

Negative:
- more local/dev complexity than a monolith
- distributed debugging

We explicitly accept the complexity because learning microservices is one of the project goals.
