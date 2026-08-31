# ADR-002: Mock WhatsApp before real WhatsApp

## Status
Accepted

The first implementation uses a WhatsApp-shaped webhook adapter and seeded/demo messages.

Real WhatsApp integration is postponed until the core recovery flow works. This avoids making external approval, policy, pricing, and credentials the critical path.
