# 0011 — Domain events, transactional outbox, BullMQ

**Status:** Accepted · 2026-09-26

## Decision

- Synchronous in-transaction reactions (for example "invoice posted → update sales order fulfilled qty") use `@nestjs/event-emitter`, awaited inside the same transaction.
- Anything with an external side effect (email, e-invoice IRN, e-way bill, Tally sync, PDF generation) writes an **outbox** row in the same transaction. A relay worker publishes committed outbox rows to BullMQ queues. Processors are idempotent (keyed by outbox id) and retry with exponential backoff, sending to a dead-letter queue after the maximum number of attempts.
- The worker runs from the same codebase (`apps/api/src/worker.ts`) as a separate process.

## Consequences

- An external call can never happen for a transaction that rolled back, and a committed one is never lost.
