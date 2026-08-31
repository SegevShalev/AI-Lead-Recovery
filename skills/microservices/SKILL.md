# Skill: Microservices

## Rules
- Define ownership before creating a service.
- Services communicate through contracts, not shared implementation details.
- Async events must have event type, version, event ID, timestamp, tenant/business ID, and correlation ID where useful.
- Consumers must tolerate duplicate delivery.
- Do not require distributed transactions for the MVP.
- Prefer eventual consistency for dashboard projections.

## Debuggability
Every request/event should carry a correlation ID.
Logs should include service name, environment, correlation ID, and event ID where applicable.
